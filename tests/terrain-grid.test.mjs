import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createGridMesh } from '../src/terrain-grid.js'

function grid(reverse = false) {
  const rows = 128, cols = 12, positions = []
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) positions.push(reverse ? -col : col, Math.sin(row * .1) * .2, row - 64)
  }
  const source = new THREE.BufferGeometry()
  source.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return createGridMesh(source, new THREE.MeshBasicMaterial(), {
    rows, cols, reverse, mediumColumns: [0, 2, 4, 6, 8, 10, 12], lowColumns: [0, 4, 8, 12],
  })
}

function visible(patch, camera) {
  const {mesh} = patch
  camera.updateMatrixWorld()
  mesh.onBeforeRender(null, null, camera)
  const {start, count} = mesh.geometry.drawRange
  const index = mesh.geometry.index.array.subarray(start, start + count)
  return {count, index, position: mesh.geometry.attributes.position}
}

test('terrain detail changes are reversible and leave every upward-facing strip continuous', () => {
  for (const reverse of [true, false]) {
    const patch = grid(reverse)
    const camera = new THREE.OrthographicCamera(-80, 80, 80, -80, .1, 200)
    camera.position.y = 100
    camera.lookAt(0, 0, 0)
    const full = visible(patch, camera)
    assert.equal(full.count, 128 * 12 * 6)
    let previous = full.count
    for (const value of [.62, .4]) {
      patch.setDetail(value)
      const {index, count, position} = visible(patch, camera)
      assert.ok(count < previous)
      previous = count
      let area = 0
      for (let i = 0; i < count; i += 3) {
        const [a, b, c] = index.subarray(i, i + 3)
        const twiceArea = (position.getZ(b) - position.getZ(a)) * (position.getX(c) - position.getX(a))
          - (position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a))
        assert.ok(twiceArea > 0)
        area += twiceArea / 2
      }
      assert.equal(area, 128 * 12)
    }
    patch.setDetail(1)
    assert.deepEqual(visible(patch, camera).index, full.index)
    patch.mesh.geometry.dispose()
    patch.mesh.material.dispose()
  }
})

test('a moving camera excludes distant bands and restores them after turning back', () => {
  const patch = grid()
  const camera = new THREE.OrthographicCamera(-20, 20, 8, -8, .1, 200)
  camera.position.set(0, 100, 36)
  camera.lookAt(0, 0, 36)
  const near = visible(patch, camera)
  assert.ok(near.count > 0 && near.count < 128 * 12 * 6 / 2)
  assert.ok(near.index.every(i => near.position.getZ(i) >= 0))
  camera.position.z = -44
  camera.lookAt(0, 0, -44)
  const far = visible(patch, camera)
  assert.ok(far.index.every(i => far.position.getZ(i) < 0))
  camera.position.z = 36
  camera.lookAt(0, 0, 36)
  assert.deepEqual(visible(patch, camera).index, near.index)
  patch.mesh.geometry.dispose()
  patch.mesh.material.dispose()
})
