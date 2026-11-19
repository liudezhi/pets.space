import * as THREE from 'three'

export function gridDetailLevel(value) {
  if (value >= .85) return 0
  return value > .48 ? 1 : 2
}

// Keep longitudinal slices in draw order in one index buffer. Visible slices form one
// contiguous draw per strip, even as a winding bank enters and leaves the view. All
// detail levels share the original vertex attributes, normals and shoreline endpoints.
export function createGridMesh(source, material, {
  rows, cols, offset = 0, firstCol = 0, lastCol = cols, reverse = false,
  mediumColumns, lowColumns, nearStep = 2, farStep = 4,
}) {
  const geometry = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute)
  const position = source.attributes.position
  const vertex = (row, col) => offset + row * (cols + 1) + col
  const point = new THREE.Vector3()
  const bounds = new THREE.Box3()
  const slices = []
  for (let start = 0; start < rows; start += 16) {
    const end = Math.min(start + 16, rows)
    const box = new THREE.Box3()
    for (let row = start; row <= end; row++) {
      for (let col = firstCol; col <= lastCol; col++) box.expandByPoint(point.fromBufferAttribute(position, vertex(row, col)))
    }
    bounds.union(box)
    slices.push({ start, end, box, ranges: [] })
  }
  geometry.boundingBox = bounds
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere())

  const full = Array.from({length: lastCol - firstCol + 1}, (_, i) => firstCol + i)
  const clipped = columns => [firstCol, ...columns.filter(col => col > firstCol && col < lastCol), lastCol]
  const levels = [full, clipped(mediumColumns), clipped(lowColumns)]
  const indices = []
  for (let level = 0; level < levels.length; level++) {
    const columns = levels[level]
    for (const slice of slices) {
      const begin = indices.length
      for (let row = slice.start; row < slice.end;) {
        const distanceAlongRiver = Math.abs(position.getZ(vertex(row, firstCol)))
        // Keep the contours at the bridge's foot intact in all modes. Distant bends
        // beyond the visitor boundary use larger triangles only on the lightest tier.
        let step = 1
        if (level && distanceAlongRiver > 5) step = level === 2 && distanceAlongRiver > 48 ? farStep : nearStep
        const next = Math.min(slice.end, row + step)
        for (let j = 1; j < columns.length; j++) {
          const a = vertex(row, columns[j - 1]), b = vertex(next, columns[j - 1])
          const c = vertex(next, columns[j]), d = vertex(row, columns[j])
          if (reverse) indices.push(a, c, b, a, d, c)
          else indices.push(a, b, c, a, c, d)
        }
        row = next
      }
      slice.ranges.push([begin, indices.length])
    }
  }
  geometry.setIndex(indices)
  const mesh = new THREE.Mesh(geometry, material)
  const clip = new THREE.Matrix4(), previous = new THREE.Matrix4(), frustum = new THREE.Frustum()
  const inView = slice => frustum.intersectsBox(slice.box)
  let tier = 0, dirty = true

  function draw(first, last) {
    const start = first.ranges[tier][0], end = last.ranges[tier][1]
    geometry.setDrawRange(start, end - start)
  }
  draw(slices[0], slices.at(-1))
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld)
    if (!dirty && previous.equals(clip)) return
    previous.copy(clip)
    dirty = false
    frustum.setFromProjectionMatrix(clip, camera.coordinateSystem, camera.reversedDepth)
    const first = slices.find(inView)
    if (!first) {
      geometry.setDrawRange(0, 0)
      return
    }
    const last = slices.findLast(inView)
    draw(first, last)
  }
  return {mesh, setDetail(value) {
    const next = gridDetailLevel(value)
    if (tier === next) return
    tier = next
    dirty = true
    draw(slices[0], slices.at(-1))
  }}
}
