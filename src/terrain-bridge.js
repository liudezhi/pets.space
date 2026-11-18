import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'

const END = 6.5, HALF_WIDTH = 1.575
const SPAN = 4.5, RISE = 1.98, SPRING = -.38, RING = .34
const deck = x => 2.1 - .95 * (x / END) ** 2
const arc = (angle, rim, z) => [(SPAN + rim) * Math.cos(angle), SPRING + (RISE + rim) * Math.sin(angle), z]

// Keep the mortar behind the stone faces: it shows through the narrow joints, including
// the vault above a visitor standing on the bank, without closing off the span.
function mortarCore(group) {
  const shape = new THREE.Shape()
  shape.moveTo(-END, -1.6)
  for (let i = 0; i <= 50; i++) {
    const x = -END + i * 2 * END / 50
    shape.lineTo(x, deck(x) - .02)
  }
  shape.lineTo(END, -1.6)
  shape.lineTo(SPAN + .04, -1.6)
  for (let i = 0; i <= 64; i++) {
    const [x, y] = arc(i * Math.PI / 64, .04, 0)
    shape.lineTo(x, y)
  }
  shape.lineTo(-SPAN - .04, -1.6)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: 2 * HALF_WIDTH - .06, bevelEnabled: false})
  geometry.translate(0, 0, -HALF_WIDTH + .03)
  const mortar = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: '#958e7c', roughness: 1}))
  mortar.name = '石桥灰缝'
  group.add(mortar)
}

export function addBridge(group) {
  mortarCore(group)
  const positions = [], uvs = [], colors = []
  const palette = ['#f1efe1', '#f5f1e8', '#e1e2d3', '#e6e5dc', '#dcd8c7', '#f6eedc'].map(c => new THREE.Color(c))
  const woodAsh = new THREE.Color('#c6c8ae')
  let seed = 182
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
  function stone(damp = 0) {
    const grain = palette[Math.floor(random() * palette.length)].clone().lerp(woodAsh, damp)
    return {color: grain, u: random() * 6, v: random() * 6, scale: .64 + random() * .16}
  }

  // All the dressing, flagstones, copings and the curved soffit share one GPU batch.
  // Sample across each individual stone in metres, preserving the size of the grain.
  function face(a, b, c, d, finish, axis) {
    for (const p of [a,b,c,a,c,d]) {
      positions.push(...p)
      colors.push(finish.color.r, finish.color.g, finish.color.b)
      const horizontal = axis === 'x' ? p[2] : p[0]
      const vertical = axis === 'y' ? p[2] : p[1]
      uvs.push(horizontal * finish.scale + finish.u, vertical * finish.scale + finish.v)
    }
  }

  // At the visible faces the projected courses stop against the outer arc of the ring.
  function openingTop(x) {
    if (x > SPAN + RING) return -1.7
    return SPRING + (RISE + RING) * Math.sqrt(Math.max(0, 1 - (x / (SPAN + RING)) ** 2))
  }
  function openingEdge(y) {
    if (y <= SPRING) return SPAN + RING
    if (y >= SPRING + RISE + RING) return 0
    return (SPAN + RING) * Math.sqrt(1 - ((y - SPRING) / (RISE + RING)) ** 2)
  }
  function faceCourses(side) {
    for (let y = -1.62, row = 0; y < 2.1; row++) {
      const low = y
      y += .285 + random() * .105
      const high = y - .013
      for (const bank of [-1,1]) {
        for (let start = row % 2 ? -.43 : -.1; start < END;) {
          const next = Math.min(END, start + .62 + .59 * random())
          const left = Math.max(0, start + .007, openingEdge(high))
          const right = Math.min(next - .007, END * Math.sqrt(Math.max(0, (2.1 - low) / .95)))
          start = next
          if (right - left < .016) continue
          const z = side * (HALF_WIDTH + random() * .024)
          const finish = stone(Math.max(0, .55 - low * .55))
          const cuts = [left, right]
          for (const corner of [openingEdge(low), SPAN + RING, (left + right) / 2]) {
            if (corner > left && corner < right) cuts.push(corner)
          }
          cuts.sort((a,b) => a - b)
          for (let i = 0; i < cuts.length - 1; i++) {
            const x = cuts[i], xx = cuts[i + 1]
            const top = v => Math.min(high, deck(v))
            const base = v => Math.min(top(v), Math.max(low, openingTop(v) + .008))
            const a = [bank*x,base(x),z], b = [bank*xx,base(xx),z]
            const c = [bank*xx,top(xx),z], d = [bank*x,top(x),z]
            face(a,b,c,d,finish,'z')
            const back = p => [p[0],p[1] + .004,side * (HALF_WIDTH - .031)]
            face(c,d,back(d),back(c),finish,'y')
            if (i === 0) face(a,d,back(d),back(a),finish,'x')
            if (i + 2 === cuts.length) face(b,c,back(c),back(b),finish,'x')
          }
        }
      }
    }
  }

  function voussoirs(side) {
    const count = 25
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI / count + .0015, b = (i + 1) * Math.PI / count - .0015
      const crown = i === (count - 1) / 2
      const z = side * (HALF_WIDTH + (crown ? .091 : .047) + .016 * random())
      const rim = crown ? RING + .066 : RING
      const finish = stone(.27 * (1 - Math.sin(a)))
      for (const [from,to] of [[a,(a+b)/2],[(a+b)/2,b]]) {
        face(arc(from,0,z),arc(to,0,z),arc(to,rim,z),arc(from,rim,z),finish,'z')
        face(arc(from,rim,z),arc(to,rim,z),arc(to,rim,side*HALF_WIDTH),arc(from,rim,side*HALF_WIDTH),finish,'y')
        face(arc(from,0,z),arc(to,0,z),arc(to,0,side*(HALF_WIDTH-.13)),arc(from,0,side*(HALF_WIDTH-.13)),finish,'y')
      }
    }
  }

  // The underside is built with staggered transverse beds. The slight darkening towards
  // the middle of the vault approximates the shade which the direct sky cannot reach.
  for (let band = 0; band < 5; band++) {
    const span = 2 * (HALF_WIDTH - .125) / 5
    const z = -HALF_WIDTH + .125 + span * band + .004, zz = z + span - .008
    for (let i = band % 2 ? -0.5 : 0; i < 25; i++) {
      const a = Math.max(i,0) * Math.PI / 25 + .0017, b = Math.min(i+1,25) * Math.PI / 25 - .0017
      const finish = stone(.2)
      finish.color.multiplyScalar(.58 + .13 * Math.abs(band-2))
      for (const [from,to] of [[a,(a+b)/2],[(a+b)/2,b]]) {
        face(arc(from,0,z),arc(to,0,z),arc(to,0,zz),arc(from,0,zz),finish,'y')
      }
    }
  }

  // A filling course and a wider, weather-shed coping form the low parapets. An inset
  // face catches the sunlight along each exposed edge instead of an unbroken sharp line.
  function parapetBlock(a,b,inner,outer,bottom,height,cap,finish) {
    const point = (x,z,lift) => [x,deck(x)+lift,z]
    const sides = [[a,inner],[b,inner],[b,outer],[a,outer]]
    const sign = Math.sign(outer)
    const inset = Math.min(cap, (b-a)*.21)
    const crown = [[a+inset,inner+sign*inset],[b-inset,inner+sign*inset],[b-inset,outer-sign*inset],[a+inset,outer-sign*inset]]
    const raised = crown.map(([x,z]) => point(x,z,height))
    for (let i=0; i<4; i++) {
      const j=(i+1)%4
      const [x,z]=sides[i], [xx,zz]=sides[j]
      const u=point(x,z,height-cap), v=point(xx,zz,height-cap)
      const axis = i % 2 ? 'x' : 'z'
      face(point(x,z,bottom),point(xx,zz,bottom),v,u,finish,axis)
      if(cap) face(u,v,raised[j],raised[i],finish,axis)
    }
    face(...raised,finish,'y')
  }
  for (const side of [-1,1]) {
    faceCourses(side)
    voussoirs(side)
    for (let layer=0; layer<3; layer++) {
      const cap = layer===2
      const inner=side*(cap ? 1.235 : 1.27), outer=side*(cap ? 1.665 : 1.595)
      for (let x=-END; x<END;) {
        let next=Math.min(END,x+.68+random()*.52)
        if (END-next<.24) next=END
        const h = (cap ? .475 : (layer+1)*.174) + (cap ? .018*random() : 0)
        parapetBlock(x+.008,next-.008,inner,outer,layer*.174,h,cap ? .031 : .006,stone())
        x=next
      }
    }
  }

  for (let lane=0; lane<4; lane++) {
    const z = -1.27 + lane*.635 + .005, zz=z+.625
    for(let x=-END; x<END;) {
      let next=Math.min(END,x+.64+random()*.54)
      if(END-next<.19) next=END
      const a=x+.008, b=next-.008
      face([a,deck(a),z],[a,deck(a),zz],[b,deck(b),zz],[b,deck(b),z],stone(),'y')
      x=next
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  geo.computeVertexNormals()
  const limestone = surfaceTexture('limestone')
  const stones = new THREE.Mesh(geo,new THREE.MeshStandardMaterial({
    map:limestone, bumpMap:limestone, bumpScale:.018, roughness:.94,
    vertexColors:true, side:THREE.DoubleSide,
  }))
  stones.userData.habitat = 'stone'
  stones.name = '溪上石拱桥'
  group.add(stones)
}
