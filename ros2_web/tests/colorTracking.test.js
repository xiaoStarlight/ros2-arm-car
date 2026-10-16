import assert from 'node:assert/strict'
import test from 'node:test'
import { ColorCubeDetector } from '../src/vision/colorTracker.js'
import { ArmColorFollower, FOLLOW_INTERVAL_MS, FOLLOW_SETTLE_MS } from '../src/vision/armFollower.js'

function frame(rectangles = []) {
  const width = 160, height = 120, data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([90, 90, 90, 255], i * 4)
  for (const [x, y, w, h, rgb] of rectangles) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data.set([...rgb, 255], (row * width + col) * 4)
  }
  return { width, height, data }
}

test('five pure cube colors are separated and their bounding boxes are accurate', () => {
  const cubes = [[5, 10, 16, 16, [230, 25, 25]], [34, 10, 16, 16, [25, 70, 230]],
    [63, 10, 16, 16, [25, 190, 60]], [92, 10, 16, 16, [230, 200, 25]], [121, 10, 16, 16, [240, 110, 20]]]
  for (const [index, color] of ['red', 'blue', 'green', 'yellow', 'orange'].entries()) {
    const result = new ColorCubeDetector().detect(frame(cubes), color)
    assert.ok(result)
    assert.equal(result.x, cubes[index][0] / 160)
    assert.equal(result.y, 10 / 120)
    assert.equal(result.width, 16 / 160)
    assert.equal(result.height, 16 / 120)
  }
})

test('neutral frames, small noise and long colored strips do not trigger tracking', () => {
  const detector = new ColorCubeDetector()
  for (const image of [frame(), frame([[10,10,2,2,[255,0,0]]]), frame([[10,10,90,3,[255,0,0]]])]) {
    assert.equal(detector.detect(image, 'red'), null)
  }
})

test('target lock avoids an immediate jump to a distant same-color blob', () => {
  const detector = new ColorCubeDetector()
  assert.ok(detector.detect(frame([[10,10,18,18,[255,0,0]]]), 'red'))
  assert.equal(detector.detect(frame([[120,70,20,20,[255,0,0]]]), 'red'), null)
})

test('confirmed physical directions drive left, right, up and down in 10-degree steps', () => {
  for (const [target, expected] of [
    [{cx:.8,cy:.5}, {channel:1,angle:80}],
    [{cx:.2,cy:.5}, {channel:1,angle:100}],
    [{cx:.5,cy:.8}, {channel:4,angle:110}],
    [{cx:.5,cy:.2}, {channel:4,angle:90}]
  ]) {
    const follower = new ArmColorFollower(), angles = { 1: 90, 4: 100 }, moves = []
    assert.equal(follower.start(1,4), true)
    const send = (channel, angle) => { moves.push({ channel, angle }); angles[channel] = angle; return true }
    for (const now of [0,125,250]) follower.update(target, angles, now, send)
    assert.deepEqual(moves, [expected], 'The first movement is a correction, with no direction probe')
    follower.update(target, angles, 250 + FOLLOW_INTERVAL_MS - 50, send)
    assert.equal(moves.length, 1, 'Wait for the previous interpolated movement')
    const closer = {cx: target.cx, cy: target.cy}
    const axis = expected.channel === 1 ? 'cx' : 'cy'
    closer[axis] += (0.5 - closer[axis]) * .2
    follower.update(closer, angles, 250 + FOLLOW_INTERVAL_MS, send)
    assert.equal(moves.length, 2)
    assert.equal(moves[1].channel, expected.channel)
    assert.equal(Math.abs(moves[1].angle - expected.angle), 10)
    follower.update(closer, angles, 250 + FOLLOW_INTERVAL_MS + 50, send)
    assert.equal(moves.length, 2, 'Commands are not emitted faster than the interpolation interval')
  }
})

test('centered and missing targets issue no motion, while unresponsive or unknown poses stop following', () => {
  const follower = new ArmColorFollower()
  follower.start(1,4)
  const moves = [], send = (channel, angle) => { moves.push({channel,angle}); return true }
  for (const now of [0,125,250]) follower.update({cx:.5,cy:.5}, {1:90,4:90}, now, send)
  assert.equal(moves.length, 0)
  follower.update(null, {1:90,4:90}, 500, send)
  assert.equal(follower.active, true, 'A missing object keeps following armed')
  assert.equal(moves.length, 0)
  follower.start(1,4)
  for (const now of [0,125,250]) follower.update({cx:.8,cy:.5}, {}, now, send)
  assert.equal(moves.length, 0)
  assert.equal(follower.active, false)
  follower.start(1,4)
  const angles = {1:90,4:90}
  const update = (channel, angle) => { angles[channel] = angle; return true }
  for (const now of [0,125,250,1650,3050]) follower.update({cx:.8,cy:.5}, angles, now, update)
  assert.equal(follower.active, false, 'Repeated unresponsive movements stop')
})

test('tracking excludes the gripper and stops at joint limits or failed sends', () => {
  const follower = new ArmColorFollower()
  assert.equal(follower.start(1,5), false)
  assert.equal(follower.start(1,1), false)
  assert.equal(follower.start(2,4), false)
  follower.start(1,4)
  for (const now of [0,125,250]) follower.update({cx:.8,cy:.5}, {1:20,4:90}, now, () => assert.fail('Limit command should not publish'))
  assert.equal(follower.active, false)
  follower.start(1,4)
  for (const now of [0,125,250]) follower.update({cx:.8,cy:.5}, {1:90,4:90}, now, () => false)
  assert.equal(follower.active, false)
})

test('fixed-step correction approaches both axes then holds instead of oscillating', () => {
  const follower = new ArmColorFollower(), angles = {1:90,4:90}
  const target = {cx:.8,cy:.25,width:.08,height:.1}
  const commands = []
  let now = 0
  follower.start(1,4)
  const send = (channel, angle) => {
    const delta = angle - angles[channel]
    if (channel === 1) target.cx += delta * .02
    else target.cy -= delta * .02
    commands.push({channel,angle,now}); angles[channel] = angle
    return true
  }
  for (now = 0; now < 120000; now += 125) {
    follower.update({...target}, angles, now, send)
    assert.equal(follower.active, true)
    if (now > 20000) break
  }
  assert.ok(Math.abs(target.cx - .5) <= .101)
  assert.ok(Math.abs(target.cy - .5) <= .101)
  const heldCount = commands.length
  for (; now < 30000; now += 125) follower.update({...target}, angles, now, send)
  assert.equal(commands.length, heldCount, 'Stationary target does not cause repeated reversals')
  for (let index = 1; index < commands.length; index++) {
    assert.ok(commands[index].now - commands[index - 1].now >= FOLLOW_INTERVAL_MS)
  }
  assert.ok(commands.every(command => command.channel === 1 ? command.angle >= 20 && command.angle <= 180 : command.channel === 4 && command.angle >= 40 && command.angle <= 180))
  for (const channel of [1,4]) {
    let previous = 90
    for (const command of commands.filter(item => item.channel === channel)) {
      assert.equal(Math.abs(command.angle - previous), 10)
      previous = command.angle
    }
  }
})

test('last step is clipped at all four physical boundaries', () => {
  for (const [target, angles, expected] of [
    [{cx:.8,cy:.5},{1:22,4:90},{channel:1,angle:20}],
    [{cx:.2,cy:.5},{1:178,4:90},{channel:1,angle:180}],
    [{cx:.5,cy:.8},{1:90,4:178},{channel:4,angle:180}],
    [{cx:.5,cy:.2},{1:90,4:43},{channel:4,angle:40}]
  ]) {
    const follower = new ArmColorFollower(), moves = []
    follower.start(1,4)
    const send = (channel,angle) => { moves.push({channel,angle}); angles[channel]=angle; return true }
    for (const now of [0,125,250,1650]) follower.update(target,angles,now,send)
    assert.deepEqual(moves,[expected])
    assert.equal(follower.active,false)
  }
})

test('a fractional remembered angle still changes by exactly ten degrees', () => {
  const follower = new ArmColorFollower(), moves = []
  follower.start(1,4)
  for (const now of [0,125,250]) follower.update({cx:.8,cy:.5},{1:90.25,4:90},now,(channel,angle)=>{moves.push({channel,angle});return true})
  assert.deepEqual(moves,[{channel:1,angle:80.25}])
})

test('center crossing restores the nearer position once and resumes when the target moves', () => {
  const follower = new ArmColorFollower(), angles = {1:90,4:90}, moves = []
  const target = {cx:.52,cy:.5,width:.04,height:.1}
  follower.start(1,4)
  const send = (channel,angle) => {
    target.cx += (angle-angles[channel])*.016
    angles[channel]=angle; moves.push({channel,angle}); return true
  }
  for (const now of [0,125,250,1650,3050,4450,5850]) follower.update({...target},angles,now,send)
  assert.deepEqual(moves,[{channel:1,angle:80},{channel:1,angle:90}])
  target.cx=.65
  follower.update({...target},angles,7250,send)
  assert.deepEqual(moves.at(-1),{channel:1,angle:80})
})

test('repeated movement away from the target stops instead of continuing in a wrong direction', () => {
  const follower = new ArmColorFollower(), angles = {1:90,4:90}, moves = []
  follower.start(1,4)
  const send=(channel,angle)=>{angles[channel]=angle;moves.push({channel,angle});return true}
  for(const now of [0,125,250]) follower.update({cx:.8,cy:.5},angles,now,send)
  follower.update({cx:.9,cy:.5},angles,1650,send)
  follower.update({cx:.96,cy:.5},angles,3050,send)
  assert.equal(follower.active,false)
  assert.equal(moves.length,2)
})

test('small frame jitter near center is filtered without sending alternating joint commands', () => {
  const follower = new ArmColorFollower()
  follower.start(1,4)
  follower.update({cx:.5,cy:.5}, {1:90,4:90}, 0, () => assert.fail('Unexpected movement'))
  for (let index=1;index<40;index++) {
    follower.update({cx:.5+(index%2 ? .027 : -.027),cy:.5},{1:90,4:90},index*125,()=>assert.fail('Jitter should not command a joint'))
  }
  assert.equal(follower.active,true)
})

test('similar axis errors keep a continuous joint, while an actual axis switch waits to settle', () => {
  const follower = new ArmColorFollower(), angles={1:90,4:90},moves=[]
  follower.start(1,4)
  const send=(channel,angle)=>{angles[channel]=angle;moves.push({channel,angle});return true}
  for(const now of [0,125,250]) follower.update({cx:.7,cy:.71},angles,now,send)
  assert.equal(moves[0].channel,4)
  follower.update({cx:.7,cy:.695},angles,1125,send)
  assert.equal(moves[1].channel,4,'Do not alternate joints for a tiny error difference')
  follower.update({cx:.72,cy:.6},angles,2000,send)
  assert.equal(moves.length,2,'The next joint must wait for the global interpolation')
  follower.update({cx:.72,cy:.6},angles,1125+FOLLOW_SETTLE_MS,send)
  assert.equal(moves[2].channel,1)
})

test('near-center reverse correction is delayed until interpolation and filtered feedback settle', () => {
  const follower=new ArmColorFollower(),angles={1:90,4:90},moves=[]
  follower.start(1,4)
  const send=(channel,angle)=>{angles[channel]=angle;moves.push({channel,angle});return true}
  for(const now of [0,125,250])follower.update({cx:.52,cy:.5,width:.04,height:.1},angles,now,send)
  follower.update({cx:.44,cy:.5,width:.04,height:.1},angles,250+FOLLOW_INTERVAL_MS,send)
  assert.equal(moves.length,1)
  follower.update({cx:.44,cy:.5,width:.04,height:.1},angles,250+FOLLOW_SETTLE_MS,send)
  assert.deepEqual(moves[1],{channel:1,angle:90})
})

test('one-second firmware interpolation model moves faster with fewer idle intervals in sustained same-direction tracking', () => {
  function simulate(smooth) {
    const follower=new ArmColorFollower(),angles={1:90,4:90}
    follower.start(1,4)
    let position=90,plan=null,queue=null,idleTicks=0,lastPublish=-Infinity,previous=90
    const moves=[]
    for(let now=0;now<=6000;now+=5){
      if(now%20===0){
        if(plan){
          const progress=Math.min(1,(now-plan.time)/1000)
          position=plan.from+(plan.to-plan.from)*progress
          if(progress===1)plan=null
        }
        if(queue!==null){plan={time:now,from:position,to:queue};queue=null}
        if(now>500&&Math.abs(position-previous)<.001)idleTicks++
        previous=position
      }
      if(now%125!==0)continue
      const send=(channel,angle)=>{assert.equal(channel,1);angles[channel]=angle;queue=angle;moves.push({angle,now});return true}
      if(smooth)follower.update({cx:.95+(position-90)*.006,cy:.5},angles,now,send)
      else if(now>=250&&now-lastPublish>=1500){send(1,angles[1]-10);lastPublish=now}
    }
    return {travel:90-position,idleTicks,moves}
  }
  const old=simulate(false),smooth=simulate(true)
  assert.ok(smooth.travel>old.travel*1.35,`Travel comparison: ${JSON.stringify({old:old.travel,smooth:smooth.travel})}`)
  assert.ok(smooth.idleTicks<old.idleTicks*.5,`Idle tick comparison: ${JSON.stringify({old:old.idleTicks,smooth:smooth.idleTicks})}`)
  assert.ok(smooth.moves.every((move,index)=>Math.abs(move.angle-(index? smooth.moves[index-1].angle:90))===10))
})

test('target loss keeps recognition intent without commands, then resumes after settling and confirming the returned target', () => {
  const follower=new ArmColorFollower(),angles={1:90,4:90},moves=[]
  follower.start(1,4)
  const send=(channel,angle)=>{angles[channel]=angle;moves.push({channel,angle});return true}
  for(const now of [0,125,250])follower.update({cx:.8,cy:.5},angles,now,send)
  assert.deepEqual(moves,[{channel:1,angle:80}])
  for(const now of [350,500,1000])follower.update(null,angles,now,send)
  assert.equal(follower.active,true)
  assert.equal(moves.length,1,'No search movements while no object is detected')
  follower.update({cx:.2,cy:.5},angles,1050,send)
  assert.equal(moves.length,1,'A fast return waits for the previous trajectory to finish')
  for(const now of [1450,1575,1700])follower.update({cx:.2,cy:.5},angles,now,send)
  assert.deepEqual(moves.at(-1),{channel:1,angle:90})
})

test('manual stop is not rearmed by a returned target', () => {
  const follower=new ArmColorFollower()
  follower.start(1,4);follower.lost();follower.stop()
  for(const now of [0,125,250,2000])follower.update({cx:.8,cy:.5},{1:90,4:90},now,()=>assert.fail('Stopped controller must not resume'))
  assert.equal(follower.active,false)
})
