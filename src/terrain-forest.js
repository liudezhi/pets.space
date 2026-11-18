import * as THREE from 'three'

const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function paintedTexture(size, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  paint(canvas.getContext('2d'), size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// One alpha-tested spray contains individual leaves, small branchlets and light gaps.
// Intersecting sprays preserve the crown silhouette looking up from underneath it.
function leafSpray(autumn = false) {
  const random = seededRandom(58202)
  return paintedTexture(256, (ctx) => {
    ctx.lineCap = 'round'
    function twig(x, y, angle, length, level) {
      const endX = x + Math.cos(angle) * length
      const endY = y + Math.sin(angle) * length
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo((x + endX) / 2 + 3, (y + endY) / 2, endX, endY)
      ctx.strokeStyle = level === 2 ? '#706c48' : '#85805a'
      ctx.lineWidth = level * .8 + .6
      ctx.stroke()
      if (level > 0) {
        for (let i = 0; i < 6; i++) {
          const t = .18 + i * .14
          const fan = (i % 2 ? 1 : -1) * (.5 + random() * .65)
          twig(x + (endX - x) * t, y + (endY - y) * t, angle + fan, length * (.33 + random() * .19), level - 1)
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const t = .1 + i * .17
          const cx = x + (endX - x) * t
          const cy = y + (endY - y) * t
          const tilt = angle + (i % 2 ? .82 : -.82)
          const size = 4.3 + random() * 3.8
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(tilt)
          const light = Math.round(31 + random() * 26 + (185 - cy) * .04)
          const hue = autumn ? 39 + Math.round(random() * 16) : 68 + Math.round(random() * 13)
          ctx.fillStyle = autumn ? `hsl(${hue},64%,${light + 13}%)` : `hsl(${hue},28%,${light}%)`
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.quadraticCurveTo(size * .32, -size * .52, size, 0)
          ctx.quadraticCurveTo(size * .42, size * .47, 0, 0)
          ctx.fill()
          ctx.restore()
        }
      }
    }
    twig(126, 221, -1.58, 151, 2)
    twig(122, 203, -2.2, 100, 2)
    twig(128, 207, -.83, 111, 2)
  })
}

function instanceMesh(group, geometry, material, entries) {
  if (!entries.length) return
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length)
  const helper = new THREE.Object3D()
  for (let i = 0; i < entries.length; i++) {
    const { position, rotation, scale, color } = entries[i]
    helper.position.copy(position)
    helper.rotation.set(...rotation)
    helper.scale.set(...scale)
    helper.updateMatrix()
    mesh.setMatrixAt(i, helper.matrix)
    if (color) mesh.setColorAt(i, color)
  }
  mesh.computeBoundingSphere()
  group.add(mesh)
}

// Joined tapered rings allow one bark mesh to contain irregular limbs of varying girth.
function barkBuilder() {
  const vertices = [], colors = [], indices = []
  const p = new THREE.Vector3()
  const tint = new THREE.Color()
  function limb(points, radii, sides, color, random) {
    const start = vertices.length / 3
    const axis = points.at(-1).clone().sub(points[0]).normalize()
    const cross = Math.abs(axis.y) > .86 ? new THREE.Vector3(1, 0, 0) : UP
    const basis = axis.clone().cross(cross).normalize()
    const normal = new THREE.Vector3()
    const grain = Array.from({ length: sides }, () => .84 + random() * .29)
    for (let r = 0; r < points.length; r++) {
      const direction = points[Math.min(r + 1, points.length - 1)].clone().sub(points[Math.max(0, r - 1)]).normalize()
      const across = direction.clone().cross(basis).normalize()
      normal.crossVectors(across, direction).normalize()
      for (let j = 0; j < sides; j++) {
        const angle = j * TAU / sides
        const radius = radii[r] * grain[j]
        p.copy(points[r]).addScaledVector(normal, Math.cos(angle) * radius).addScaledVector(across, Math.sin(angle) * radius)
        vertices.push(p.x, p.y, p.z)
        tint.copy(color).multiplyScalar(grain[j] * (.9 + r * .026))
        colors.push(tint.r, tint.g, tint.b)
        if (r) {
          const a = start + (r - 1) * sides + j, b = start + (r - 1) * sides + ((j + 1) % sides)
          indices.push(a, b, a + sides, b, b + sides, a + sides)
        }
      }
    }
  }
  function finish(group) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
    group.add(mesh)
  }
  return { limb, finish }
}

function coniferTexture() {
  const random = seededRandom(88321)
  return paintedTexture(256, ctx => {
    ctx.fillStyle = '#585c4b'
    ctx.fillRect(125, 24, 5, 227)
    for (let row = 0; row < 30; row++) {
      const t = row / 30
      const y = 22 + t * 199
      const width = (3 + t * 74) * (.85 + random() * .15)
      for (const side of [-1, 1]) {
        for (let i = 0; i < 25; i++) {
          const reach = width * random()
          const startY = y + random() * 8
          const drop = reach * .38 + random() * 8
          const light = Math.round(20 + random() * 16 + (side === -1 ? 5 : 0))
          ctx.strokeStyle = 'hsl(111,15%,' + light + '%)'
          ctx.lineWidth = 1.5 + random() * 2
          ctx.beginPath()
          ctx.moveTo(128 + side * reach * .25, startY)
          ctx.lineTo(128 + side * reach, startY + drop)
          ctx.lineTo(128 + side * (reach + 3), startY + drop - 5)
          ctx.stroke()
        }
      }
    }
  })
}

// Paper birch has irregular lenticels across pale bark; keep the markings in the
// shared trunk atlas so their cost is independent of camera distance.
function addBirches(group, heightAt, bark) {
  const random = seededRandom(93201)
  const barkMap = paintedTexture(256, ctx => {
    ctx.fillStyle = '#d9d3bd'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 600; i++) {
      const x = random() * 256, y = random() * 256
      ctx.fillStyle = random() < .55 ? 'rgba(127,120,103,.1)' : 'rgba(255,251,224,.22)'
      ctx.fillRect(x, y, 4 + random() * 29, 1 + random() * 4)
    }
    for (let i = 0; i < 65; i++) {
      const x = random() * 256, y = random() * 256
      const length = 4 + random() ** 2 * 41
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + length * .37, y - 1 - random() * 1.1)
      ctx.lineTo(x + length, y - random())
      ctx.lineTo(x + length * .32, y + random() * 1.7)
      ctx.fillStyle = i % 4 ? '#635e52' : '#383934'
      ctx.fill()
    }
  })
  barkMap.wrapT = THREE.RepeatWrapping
  barkMap.repeat.y = 3
  const trunk = new THREE.CylinderGeometry(.065, .18, 1, 13, 10)
  trunk.translate(0, .5, 0)
  const trunkEntries = [], leaves = []
  const branchColor = new THREE.Color(0x897b67)
  for (const [x, z, height, lean] of [[-37,23,7.7,.45],[-35,21,8.9,-.35],[-30,29,7.9,.42]]) {
    const ground = heightAt(x, z) - .08
    trunkEntries.push({
      position: new THREE.Vector3(x, ground, z), rotation: [0, 0, -Math.atan(lean / height)],
      scale: [1, height, 1]
    })
    for (let j = 0; j < 16; j++) {
      const t = .33 + j * .037, direction = j * 2.39996 + random() * .45
      const length = (.75 + 3.1 * Math.sin(t * Math.PI)) * (.65 + random() * .28)
      const dx = Math.cos(direction) * length, dz = Math.sin(direction) * length
      const origin = new THREE.Vector3(x + lean * t, ground + height * t, z)
      const fork = origin.clone().add(new THREE.Vector3(dx * .64, .68, dz * .64))
      const tip = origin.clone().add(new THREE.Vector3(dx, .7 + random() * .6, dz))
      bark.limb([origin, fork, tip], [.073, .041, .014], 6, branchColor, random)
      for (let k = 0; k < 8; k++) {
        const a = direction + random() * 2 - 1
        const length = .22 + random() * .75
        const pos = fork.clone().lerp(tip, random()).add(new THREE.Vector3(Math.cos(a) * length, -.04 - random() * .55, Math.sin(a) * length))
        const size = .87 + random() * .48
        leaves.push({ position: pos, rotation: [random() * 1.7 - .85, a, random() - .5], scale: [size * 1.07, size, size] })
      }
    }
  }
  instanceMesh(group, trunk, new THREE.MeshStandardMaterial({ map: barkMap, roughness: .94 }), trunkEntries)
  instanceMesh(group, new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    map: leafSpray(true), side: THREE.DoubleSide, alphaTest: .3, roughness: 1, emissive: 0x2a1f09
  }), leaves)
}

export function addForest(group, heightAt, riverX) {
  const random = seededRandom(850312)
  const bark = barkBuilder()
  const sprays = [], pines = []
  const ribbonVertices = [], ribbonIndices = [], ribbonColors = []
  const ribbons = [0xb6926e, 0xbeaa8a, 0x9e756b, 0xb39a74, 0x9bafa6]
  const shadeTexture = paintedTexture(128, (ctx) => {
    const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 61)
    glow.addColorStop(0, 'rgba(32,41,25,.48)')
    glow.addColorStop(.47, 'rgba(41,51,34,.29)')
    glow.addColorStop(1, 'rgba(48,53,37,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 128, 128)
  })
  const shadeMaterial = new THREE.MeshBasicMaterial({ map: shadeTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
  function shade(x, z, width) {
    const geo = new THREE.PlaneGeometry(width, width, 9, 9)
    geo.rotateX(-Math.PI / 2)
    const positions = geo.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i) + x
      const pz = positions.getZ(i) + z
      positions.setXYZ(i, px, heightAt(px, pz) + .045, pz)
    }
    group.add(new THREE.Mesh(geo, shadeMaterial))
  }

  function ribbon(start, length) {
    const base = ribbonVertices.length / 3
    const tint = new THREE.Color(ribbons[Math.floor(random() * ribbons.length)])
    const angle = random() * TAU
    const width = .052 + random() * .045
    for (let k = 0; k <= 5; k++) {
      const t = k / 5
      const cx = start.x + Math.sin(t * 5 + angle) * .06 * t + t * .13
      const cz = start.z + Math.sin(t * 4) * .07
      const cy = start.y - length * t
      const dx = Math.cos(angle + t * .85) * width * .5
      const dz = Math.sin(angle + t * .85) * width * .5
      ribbonVertices.push(cx - dx, cy, cz - dz, cx + dx, cy, cz + dz)
      for (let j = 0; j < 2; j++) ribbonColors.push(tint.r, tint.g, tint.b)
      if (k) {
        const a = base + (k - 1) * 2
        ribbonIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }

  function oak(x, z, scale, hero = false) {
    const base = heightAt(x, z)
    const origin = new THREE.Vector3(x, base, z)
    const local = (dx, h, dz) => new THREE.Vector3(x + dx * scale, base + h * scale, z + dz * scale)
    const wood = new THREE.Color(hero ? 0x78705c : 0x817e69)
    const bend = random() * TAU, bx = Math.sin(bend), bz = Math.cos(bend)
    const trunk = [local(0, -.12, 0), local(0, .46, 0), local(.09 * bx, 1.68, .09 * bz), local(.3 * bx, 3.1, .3 * bz), local(.42 * bx, 4.2, .42 * bz)]
    bark.limb(trunk, [.74, .55, .47, .37, .23].map(r => r * scale), hero ? 16 : 10, wood, random)
    const branches = hero ? 13 : 8
    for (let i = 0; i < branches; i++) {
      const a = i * 2.39996 + bend + random() * .47
      const span = 1.7 + random() * 1.27
      const h = 2.3 + (i / branches) * 2.15 + random() * .45
      const high = 2.35 + random() * 1.6
      const u = Math.cos(a), v = Math.sin(a)
      const start = local(bx * .25, h, bz * .25)
      const elbow = local(u * span * .54, h + high * .41, v * span * .54)
      const fork = local(u * span, h + high * .8, v * span)
      bark.limb([start, elbow, fork], [.225, .153, .077].map(r => r * scale), 8, wood, random)
      if (hero && i <= 5) {
        for (let l = 0; l < 2; l++) ribbon(elbow.clone().lerp(fork, .2 + .56 * random()), .42 + random() * .63)
      }
      const twigs = hero ? 5 : 3
      for (let j = 0; j < twigs; j++) {
        const dir = a + (j / twigs - .4) * 1.9 + random() * .5
        const distance = (.85 + random() * 1.1) * scale
        const tip = fork.clone().add(new THREE.Vector3(Math.cos(dir) * distance, (.2 + random() * 1.38) * scale, Math.sin(dir) * distance))
        const mid = fork.clone().lerp(tip, .55)
        mid.y += .1 * scale
        bark.limb([fork, mid, tip], [.08, .053, .019].map(r => r * scale), 5, wood, random)
        for (let k = 0; k < (hero ? 8 : 6); k++) {
          const radius = (.1 + random() * .9) * scale
          const t = random() * TAU
          const pos = tip.clone().add(new THREE.Vector3(Math.cos(t) * radius, (random() - .46) * .9 * scale, Math.sin(t) * radius))
          const size = (.93 + random() * .57) * scale
          const yaw = random() * TAU
          const light = THREE.MathUtils.clamp(.82 + (pos.y - origin.y) / (scale * 27) + random() * .18, .9, 1.3)
          const color = new THREE.Color().setRGB(light * .94, light, light * (.79 + random() * .13))
          sprays.push({ position: pos, rotation: [random() * 1.5 - .83, yaw, random() * 1.2 - .6], scale: [size * 1.36, size, size], color })
        }
      }
    }
    if (hero) {
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + random() * .35
        const length = (1.3 + random()) * scale
        const ex = x + Math.cos(a) * length, ez = z + Math.sin(a) * length
        const tip = new THREE.Vector3(ex, heightAt(ex, ez) + .02, ez)
        const middle = trunk[1].clone().lerp(tip, .55)
        middle.y = heightAt(middle.x, middle.z) + .13 * scale
        bark.limb([trunk[1], middle, tip], [.27 * scale, .16 * scale, .018], 7, wood, random)
      }
      shade(x, z, scale * 9.8)
    }
  }

  oak(20, -16, 1.47, true)
  for (const [x, z, scale] of [[-30,38,.88], [-44,8,.86], [-36,-19,.75], [-32,-25,.81], [30,4,.79], [43,-34,.95], [38,-38,.81], [20,37,.84], [-21,-47,.88]]) {
    if (Math.abs(x - riverX(z)) > 5.4) oak(x, z, scale)
  }
  addBirches(group, heightAt, bark)
  bark.finish(group)
  instanceMesh(group, new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    map: leafSpray(), side: THREE.DoubleSide, alphaTest: .32, roughness: 1, emissive: 0x151b0e
  }), sprays)

  if (ribbonVertices.length) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbonVertices, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3))
    geo.setIndex(ribbonIndices)
    geo.computeVertexNormals()
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: .96 })))
  }

  // Dark groups on the margins frame the composition; the entire central walking corridor stays clear.
  for (const [cx, cz, count] of [[-55,-22,33],[-29,-55,40],[25,-55,34],[57,-24,40],[62,26,29],[-64,36,29],[15,53,24]]) {
    for (let i = 0; i < count; i++) {
      const a = random() * TAU, r = Math.sqrt(random()) * 12
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (Math.abs(x - riverX(z)) < 6) continue
      const h = 5 + random() * 6
      const position = new THREE.Vector3(x, heightAt(x, z) + h * .47, z)
      const yaw = random() * Math.PI
      const l = .85 + random() * .28
      const color = new THREE.Color().setRGB(l, l, l * .93)
      for (let j = 0; j < 2; j++) pines.push({ position, rotation: [0, yaw + j * Math.PI / 2, 0], scale: [h * .76, h, 1], color })
    }
  }
  instanceMesh(group, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: coniferTexture(), side: THREE.DoubleSide, alphaTest: .37
  }), pines)
}
