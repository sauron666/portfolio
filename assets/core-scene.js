/* A small orthographic renderer for the interactive project viewer. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const initialYaw = 0.68;
  const initialPitch = 0.51;
  const themes = {
    'ai-dlp-guard': { light: [104, 255, 207], cool: [54, 196, 222], white: [211, 255, 232], dark: [7, 44, 46] },
    'zero-g-firewall': { light: [178, 159, 255], cool: [89, 174, 253], white: [235, 225, 255], dark: [31, 32, 67] },
    mirage: { light: [255, 192, 111], cool: [87, 219, 219], white: [255, 237, 200], dark: [55, 40, 34] }
  };
  const cutRect = (w, d, c) => {
    const x = w / 2, z = d / 2;
    return [[-x + c, -z], [x - c, -z], [x, -z + c], [x, z - c],
      [x - c, z], [-x + c, z], [-x, z - c], [-x, -z + c]];
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const rgba = (rgb, a) => 'rgba(' + rgb.join(',') + ',' + a + ')';
  const mix = (a, b, fraction) => a.map((v, i) => Math.round(v + fraction * (b[i] - v)));
  const onPlane = (outline, y, x = 0, z = 0) =>
    outline.map(([px, pz]) => [px + x, y, pz + z]);

  // Track paths are in board coordinates. Fan-outs stay attached to their
  // contact and through-hole as the camera moves.
  function makeTracks(width, depth, count) {
    const paths = [];
    for (let edge = 0; edge < 4; edge++) {
      const alongX = edge % 2 === 0;
      const sign = edge < 2 ? 1 : -1;
      const atEdge = (r, lane) => alongX
        ? [sign * r * width / 2, lane * depth / 2]
        : [lane * width / 2, sign * r * depth / 2];
      for (let i = 0; i < count; i++) {
        const lane = ((i + 0.5) / count * 2 - 1) * 0.82;
        const band = (i * 3 + edge * 2) % 7;
        const end = 0.79 + ((i + edge * 2) % 5) * 0.03;
        const near = lane * (alongX ? 0.52 : 0.48);
        const shoulder = 0.44 + band * 0.019;
        const stagger = 0.64 + band * 0.012;
        paths.push({
          band, edge, index: i, points: [
            atEdge(0.30, near), atEdge(shoulder, near),
            atEdge(shoulder + 0.13, lane * 0.88), atEdge(stagger + 0.091, lane * 0.88),
            atEdge(stagger + 0.13, lane), atEdge(end, lane)
          ]
        });
      }
    }
    return paths;
  }
  const baseTracks = makeTracks(2.92, 2.11, 17);
  const glassTracks = makeTracks(2.25, 1.65, 11);

  function paintCore(ctx, w, h, pose) {
    const theme = themes[pose.project] || themes['ai-dlp-guard'];
    const {light, cool, white, dark} = theme;
    const time = pose.time;
    const yaw = pose.yaw + (pose.manual ? 0 : 0.045 * Math.sin(time * 0.27));
    const pitch = pose.pitch;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ce = Math.cos(pitch), se = Math.sin(pitch);
    const unit = Math.min(w / 4.43, h / 2.83);
    const centerX = w * 0.505, centerY = h * 0.563;
    const px = clamp(unit / 130, 0.65, 1.3);
    const phase = time * 0.62;
    const suspension = 0.014 * Math.sin(time * 0.74);

    function project([x, y, z]) {
      const depth = sy * x + cy * z;
      return [centerX + unit * (cy * x - sy * z), centerY + unit * (se * depth - ce * y)];
    }
    function path(vertices, closePath) {
      ctx.beginPath();
      vertices.forEach((v, i) => {
        const [x, y] = project(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (closePath) ctx.closePath();
    }
    function stroke(vertices, color, weight = 1, closed = false) {
      path(vertices, closed);
      ctx.strokeStyle = color;
      ctx.lineWidth = weight * px;
      ctx.stroke();
    }
    function face(vertices, fill, edge = '', weight = 1) {
      path(vertices, true);
      ctx.fillStyle = fill;
      ctx.fill();
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = weight * px;
        ctx.stroke();
      }
    }
    function gradient(from, to, stops) {
      const a = project(from), b = project(to);
      const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
      for (const [offset, color] of stops) grad.addColorStop(offset, color);
      return grad;
    }
    function halo(x, y, radius, color, opacity, squash = 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, squash);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      glow.addColorStop(0, rgba(color, opacity));
      glow.addColorStop(0.4, rgba(color, opacity * 0.44));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    function ring(x, y, z, radius, color, weight = 1, dot = false) {
      const vertices = [];
      for (let i = 0; i < 16; i++) {
        const a = TAU * i / 16;
        vertices.push([x + radius * Math.cos(a), y, z + radius * Math.sin(a)]);
      }
      if (dot) face(vertices, color);
      else stroke(vertices, color, weight, true);
    }
    function glint(position, radius = 2, color = white) {
      const [x, y] = project(position);
      const r = radius * px;
      halo(x, y, r * 3.5, color, 0.21);
      ctx.fillStyle = rgba(color, 0.92);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.47, 0, TAU);
      ctx.fill();
    }

    // The top and the visible side faces of a chamfered part have separate
    // materials. Side normals are used for both visibility and lighting.
    function slab(outline, y, thickness, top, sides, rim, width = 1) {
      const bottom = onPlane(outline, y - thickness);
      const upper = onPlane(outline, y);
      for (let i = 0; i < outline.length; i++) {
        const next = (i + 1) % outline.length;
        const dx = outline[next][0] - outline[i][0];
        const dz = outline[next][1] - outline[i][1];
        const length = Math.hypot(dx, dz);
        const facing = (dz * sy - dx * cy) / length;
        if (facing <= 0.006) continue;
        const lightLevel = clamp((dz * -0.4 - dx * 0.9) / length * 0.5 + 0.55, 0.12, 1);
        const side = sides(lightLevel);
        const vertices = [upper[i], upper[next], bottom[next], bottom[i]];
        const gradientFill = gradient(upper[i], bottom[i], [[0, side[0]], [1, side[1]]]);
        face(vertices, gradientFill, side[2], 0.62);
      }
      face(upper, top, rim, width);
    }
    function surfaceGradient(y, width, depth, colors) {
      return gradient([-width / 2,y,-depth / 2],[width / 2,y,depth / 2],colors);
    }
    function printOutline(wd, dp, chamfer, y, color, weight) {
      stroke(onPlane(cutRect(wd,dp,chamfer),y),color,weight,true);
    }
    function ground() {
      ctx.clearRect(0, 0, w, h);
      const ambient = ctx.createLinearGradient(0,0,w,h);
      ambient.addColorStop(0, '#09121b');
      ambient.addColorStop(0.54, '#0a151e');
      ambient.addColorStop(1, '#08111a');
      ctx.fillStyle = ambient;
      ctx.fillRect(0,0,w,h);
      halo(centerX,centerY-h*0.24,unit*2.25,cool,0.075,0.67);
      const [fx, fy] = project([0,-0.22,0]);
      const fade = ctx.createRadialGradient(fx,fy,unit*0.49,fx,fy,unit*2.83);
      fade.addColorStop(0,rgba(cool,0.14));
      fade.addColorStop(0.66,rgba(cool,0.07));
      fade.addColorStop(1,rgba(cool,0));
      for (let i=-16; i<=16; i++) {
        const q = i * 0.23;
        stroke([[q,-0.22,-3.8],[q,-0.22,3.8]],fade,i%4 === 0 ? 0.84 : 0.52);
        stroke([[-3.8,-0.22,q],[3.8,-0.22,q]],fade,i%4 === 0 ? 0.84 : 0.52);
      }
      function arc(radius, start, end, color, weight) {
        const vertices = [];
        const steps = Math.max(3, Math.ceil((end-start)*26));
        for (let i=0; i<=steps; i++) {
          const a = start+(end-start)*i/steps;
          vertices.push([Math.cos(a)*radius,-0.213,Math.sin(a)*radius]);
        }
        stroke(vertices,color,weight);
      }
      for (const anchor of [-1.97,-0.30,1.18,2.81]) {
        arc(1.97,anchor,anchor+0.70,rgba(cool,0.20),0.8);
        arc(2.045,anchor+0.03,anchor+0.29,rgba(light,0.16),1.15);
      }
      for (let i=0;i<84;i++) {
        const a = i*TAU/84;
        if (i%21>12) continue;
        const r1=1.98, r2=i%3===0?2.045:2.01;
        stroke([[r1*Math.cos(a),-0.212,r1*Math.sin(a)],[r2*Math.cos(a),-0.212,r2*Math.sin(a)]],rgba(cool,i%3===0?0.27:0.16),0.76);
      }
      halo(fx+unit*0.06,fy+unit*0.28,unit*1.90,[1,5,9],0.92,0.34);
      halo(fx,fy+unit*0.14,unit*1.52,cool,0.11,0.30);
    }
    function trackBank(bank, y, onGlass) {
      for (const track of bank) {
        const vertices = onPlane(track.points, y);
        const tint = track.band === 0 ? white : track.band < 4 ? cool : light;
        const opacity = (onGlass ? 0.18 : 0.22) + track.band * 0.044;
        stroke(vertices,rgba(tint,opacity),track.band === 0 ? 1.17 : 0.78);
        const [x,z] = track.points[track.points.length - 1];
        if (track.index % 3 !== 1) ring(x,y+0.001,z,onGlass ? 0.011 : 0.014,rgba(tint,opacity+0.11),0.65);
        if (track.band===2 && track.index%4===0) {
          const speed = (phase * 0.46 + track.index / 9 + track.edge * 0.21) % 1;
          const t = speed * (vertices.length-1), i = Math.floor(t);
          const a=vertices[i], b=vertices[Math.min(i+1,vertices.length-1)];
          const f=t-i;
          glint([a[0]+(b[0]-a[0])*f,y,a[2]+(b[2]-a[2])*f],1.36,light);
        }
      }
    }
    function feetAndBase() {
      const wd=2.96, dp=2.14, top=0.015;
      slab(cutRect(wd-0.09,dp-0.09,0.16),-0.093,0.095,'#101c25',
        k=>[rgba(mix([15,27,35],cool,k*0.14),1),'#061019','#22363e'],rgba(cool,0.40),0.75);
      slab(cutRect(wd,dp,0.17),top,0.100,
        surfaceGradient(top,wd,dp,[[0,'#1a303a'],[0.41,'#0c252c'],[0.74,rgba(mix(dark,[11,23,30],0.56),1)],[1,'#18353b']]),
        k=>[rgba(mix([27,37,44],cool,k*0.22),1),rgba(mix([7,18,23],cool,k*0.055),1),rgba(cool,0.26)],
        rgba(mix(white,cool,0.58),0.72),1.25);
      printOutline(2.83,2.01,0.14,top+0.004,rgba(light,0.48),0.93);
      printOutline(2.73,1.91,0.125,top+0.004,rgba(cool,0.24),0.74);
      trackBank(baseTracks,top+0.007,false);

      for (const sign of [-1,1]) {
        for (let i=-13;i<=13;i++) {
          const x=i*0.089;
          const len=(i%5===0?0.061:0.037);
          stroke([[x,top+0.008,sign*0.963],[x,top+0.008,sign*(0.963-len)]],rgba(white,0.37),1.0);
        }
        for (let i=-9;i<=9;i++) {
          const z=i*0.088;
          stroke([[sign*1.376,top+0.008,z],[sign*1.327,top+0.008,z]],rgba(cool,0.37),0.94);
        }
      }
      for (const x of [-1.235,1.235]) for (const z of [-0.841,0.841]) {
        ring(x,0.024,z,0.061,'#08141b',1,true);
        ring(x,0.026,z,0.050,rgba(white,0.57),1.1);
        stroke([[x-0.018,0.028,z-0.017],[x+0.018,0.028,z+0.017]],rgba(cool,0.49),0.9);
      }
      // Small surface-mounted packages, with two rows of metal terminals.
      for (const sign of [-1,1]) {
        for (let i=0;i<4;i++) {
          const x=sign*(0.96+i*0.078), z=sign*0.41;
          const contacts=cutRect(0.039,0.11,0.004).map(([sx,sz])=>[x+sx,z+sz]);
          slab(contacts,0.037,0.017,rgba(white,0.50),
            ()=>['#4b6570','#132a31','#41555b'],'#415d68',0.48);
          const ceramic=cutRect(0.043,0.065,0.004).map(([sx,sz])=>[x+sx,z+sz]);
          slab(ceramic,0.049,0.018,'#233741',()=>['#253f49','#101e26','#273e46'],'#3b565e',0.5);
        }
      }
    }
    function interposers(y) {
      for (const x of [-0.95,0.95]) for (const z of [-0.68,0.68]) {
        const r=0.039;
        const hex=Array.from({length:6},(_,i)=>[x+r*Math.cos(i*TAU/6),z+r*Math.sin(i*TAU/6)]);
        ring(x,0.030,z,0.085,rgba(cool,0.45),0.9);
        slab(hex,y-0.025,y-0.058,rgba(cool,0.85),
          k=>[rgba(mix([38,67,72],white,k*0.51),0.9),rgba(mix([11,31,37],cool,k*0.20),0.85),rgba(cool,0.48)],
          rgba(white,0.65),0.76);
      }
    }
    function opticalPlate(y) {
      const wd=2.32,dp=1.73;
      const plate=cutRect(wd,dp,0.17);
      stroke(onPlane(plate,y-0.053),rgba(cool,0.52),1.12,true);
      slab(plate,y,0.053,surfaceGradient(y,wd,dp,[
        [0,rgba(mix(dark,cool,0.34),0.50)],[0.43,rgba(dark,0.54)],
        [0.76,rgba(mix(dark,light,0.18),0.46)],[1,rgba(cool,0.19)]
      ]), k=>[rgba(mix(cool,white,k*0.3),0.42),rgba(dark,0.52),rgba(cool,0.56)],
      rgba(mix(cool,white,0.27),0.83),1.25);
      printOutline(wd-0.10,dp-0.10,0.14,y+0.003,rgba(white,0.25),0.65);
      trackBank(glassTracks,y+0.006,true);
      for (const x of [-0.95,0.95]) for (const z of [-0.68,0.68]) {
        ring(x,y+0.006,z,0.055,rgba(light,0.70),1.1);
        ring(x,y+0.006,z,0.023,rgba(white,0.55),0.7);
      }
      // Glass corner glints are deliberately local instead of a glowing wire box.
      const corner=onPlane(plate,y+0.002);
      for (const i of [1,3,6]) glint(corner[i],1.75,cool);
    }

    function socket(y) {
      const wd=1.36,dp=1.04;
      const leadHeight=y-0.095;
      for (let i=0;i<20;i++) {
        const lane=(i-9.5)/9.5;
        for (const sign of [-1,1]) {
          const z=lane*0.40, x=lane*0.55;
          const leads=[
            [[sign*0.82,leadHeight-0.085,z],[sign*0.77,leadHeight-0.085,z],[sign*0.724,leadHeight,z],[sign*0.66,leadHeight,z]],
            [[x,leadHeight-0.085,sign*0.665],[x,leadHeight-0.085,sign*0.615],[x,leadHeight,sign*0.572],[x,leadHeight,sign*0.514]]
          ];
          for (const points of leads) {
            stroke(points,rgba([85,119,125],0.76),2.4);
            stroke(points,rgba(i%4===0?light:white,0.71),0.74);
          }
        }
      }
      slab(cutRect(wd,dp,0.085),y,0.13,
        surfaceGradient(y,wd,dp,[[0,'#3c4c52'],[0.30,'#1b2a33'],[0.83,'#15252d'],[1,'#33464a']]),
        k=>[rgba(mix([23,34,42],cool,k*0.20),1),'#101a23',rgba(cool,0.48)],
        rgba(white,0.72),1.08);
      printOutline(wd-0.10,dp-0.10,0.061,y+0.004,rgba(cool,0.63),0.84);
      printOutline(wd-0.16,dp-0.16,0.043,y+0.005,rgba(white,0.25),0.59);
      for (const sx of [-1,1]) for (const sz of [-1,1]) {
        const x=sx*0.55,z=sz*0.38;
        face([[x-0.016,y+0.008,z],[x,y+0.008,z-0.020],[x+0.018,y+0.008,z],[x,y+0.008,z+0.019]],rgba(light,0.9));
      }
    }
    function core(y) {
      const base=y, top=y+0.54;
      const lower=cutRect(0.89,0.82,0.084), belt=cutRect(1.02,0.92,0.10), crown=cutRect(0.91,0.82,0.12);
      const a=onPlane(lower,base), b=onPlane(belt,base+0.065), c=onPlane(belt,top-0.083), d=onPlane(crown,top);
      const back=[],front=[];
      for (let i=0;i<b.length;i++) {
        const j=(i+1)%b.length;
        const dx=b[j][0]-b[i][0], dz=b[j][2]-b[i][2];
        const facing=(dz*sy-dx*cy)/Math.hypot(dx,dz);
        (facing>0 ? front : back).push({i,j,facing});
      }
      const mid=project([0,base+0.19,0]);
      halo(mid[0],mid[1],unit*0.78,light,0.22,0.78);
      const glassFacet=({i,j,facing},backFace) => {
        const strength=Math.abs(facing);
        const fill=gradient(c[i],b[j],[[0,rgba(white,backFace ? 0.095 : 0.11+strength*0.09)],
          [0.42,rgba(cool,backFace ? 0.065 : 0.095)],[0.76,rgba(dark,backFace ? 0.12 : 0.18)],
          [1,rgba(light,backFace ? 0.135 : 0.13+strength*0.08)]]);
        face([b[i],b[j],c[j],c[i]],fill,rgba(cool,backFace?0.27:0.57),0.75);
        face([a[i],a[j],b[j],b[i]],rgba(cool,backFace?0.11:0.22),rgba(light,0.48),0.77);
        face([c[i],c[j],d[j],d[i]],rgba(white,backFace?0.11:0.15+strength*0.20),rgba(white,backFace?0.33:0.69),0.83);
        if (!backFace && strength>0.58) {
          const lo=b[i], hi=c[j];
          const p1=[lo[0]+(b[j][0]-lo[0])*0.06,lo[1],lo[2]+(b[j][2]-lo[2])*0.06];
          const p2=[lo[0]+(b[j][0]-lo[0])*0.38,lo[1],lo[2]+(b[j][2]-lo[2])*0.38];
          face([p1,p2,hi,c[i]],rgba(white,0.038));
          for (let line=0;line<7;line++) {
            const y1=base+0.112+line*0.042;
            stroke([[b[i][0],y1,b[i][2]],[b[j][0],y1,b[j][2]]],rgba(white,0.084),0.6);
          }
        }
      };
      back.forEach(part=>glassFacet(part,true));
      stroke(a,rgba(light,0.54),0.91,true);

      const innerTop=base+0.314;
      const inner=cutRect(0.585,0.495,0.059);
      slab(inner,innerTop,0.214,surfaceGradient(innerTop,0.585,0.495,[
        [0,rgba(white,0.99)],[0.23,rgba(light,0.92)],[0.7,rgba(mix(light,cool,0.65),0.97)],[1,rgba(white,0.92)]
      ]),k=>[rgba(mix(cool,light,k*0.9),0.96),rgba(mix(dark,light,k*0.46),0.94),rgba(white,0.78)],
      rgba(white,0.95),1.28);
      for (let row=0; row<5; row++) for (let col=0; col<6; col++) {
        if ((row+col*2)%8===0) continue;
        const x=(col-2.5)*0.069, z=(row-2)*0.064, half=(row+col)%3===0?0.017:0.022;
        face([[x-half,innerTop+0.003,z-half],[x+half,innerTop+0.003,z-half],
          [x+half,innerTop+0.003,z+half],[x-half,innerTop+0.003,z+half]],rgba(dark,0.45));
      }
      for (const side of [-1,1]) {
        const low=base+0.11;
        for (let i=-3;i<=3;i++) {
          const x=i*0.061;
          stroke([[x,low,side*0.25],[x,innerTop-0.025,side*0.25]],rgba(white,0.32),0.65);
        }
      }
      front.forEach(part=>glassFacet(part,false));
      face(d,surfaceGradient(top,1.0,0.9,[[0,rgba(white,0.22)],[0.42,rgba(light,0.14)],
        [0.66,rgba(dark,0.096)],[1,rgba(cool,0.29)]]),rgba(white,0.89),1.25);
      printOutline(0.79,0.70,0.080,top+0.002,rgba(white,0.57),0.8);
      // A fine pair of alignment marks etched directly into the upper cover.
      for (const s of [-1,1]) {
        stroke([[s*0.32,top+0.003,-s*0.20],[s*0.32,top+0.003,-s*0.25],[s*0.26,top+0.003,-s*0.25]],rgba(white,0.80),1.0);
      }
      for (const i of [1,3,5]) glint(d[i],1.9,white);
    }
    function registeringFrame(y) {
      const outline=cutRect(1.33,1.13,0.11);
      for (let i=0;i<outline.length;i+=2) {
        const a=outline[i], b=outline[(i+7)%8], before=outline[(i+6)%8], after=outline[(i+1)%8];
        const closeTo=(start,other,t)=>[start[0]+(other[0]-start[0])*t,y,start[1]+(other[1]-start[1])*t];
        stroke([closeTo(b,before,0.13),[b[0],y,b[1]],[a[0],y,a[1]],closeTo(a,after,0.13)],rgba(light,0.56),0.96);
      }
    }
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ground();
    feetAndBase();
    const carrier=0.306+suspension*0.35;
    interposers(carrier);
    opticalPlate(carrier);
    socket(0.566+suspension*0.55);
    core(0.724+suspension);
    registeringFrame(1.31+suspension);
  }

  function attachScene(root) {
    const canvas=root.querySelector('canvas[data-core-canvas]');
    if (!canvas || typeof canvas.getContext !== 'function') return;
    let ctx;
    try { ctx=canvas.getContext('2d',{alpha:false}); } catch { return; }
    if (!ctx) return;
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const pose={yaw:initialYaw,pitch:initialPitch,project:root.dataset.project,time:0,manual:false};
    let targetYaw=initialYaw, targetPitch=initialPitch;
    let width=0,height=0,ratio=1,lastFrame=null,frame=0;
    let pointer=null,intersecting=false,healthy=true,dirty=true;
    canvas.style.touchAction='pan-y pinch-zoom';
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex=0;
    const paused=()=>motion.matches || root.dataset.paused === 'true';
    const shouldDraw=()=>healthy && intersecting && !document.hidden && width>0 && height>0 && !root.hidden;

    function schedule() {
      if (!shouldDraw()) {
        if (frame) cancelAnimationFrame(frame);
        frame=0;
        lastFrame=null;
        return;
      }
      if (!frame && (dirty || !paused())) frame=requestAnimationFrame(draw);
    }
    function draw(now) {
      frame=0;
      if (!shouldDraw()) {lastFrame=null;return;}
      const elapsed=lastFrame===null ? 0 : now-lastFrame;
      if (!dirty && lastFrame!==null && elapsed<32) {schedule();return;}
      if (lastFrame!==null && !paused()) pose.time+=Math.min(elapsed,75)/1000;
      const ease=paused() || lastFrame===null ? 1 : 1-Math.exp(-Math.max(elapsed,16)/64);
      pose.yaw+=(targetYaw-pose.yaw)*ease;
      pose.pitch+=(targetPitch-pose.pitch)*ease;
      lastFrame=now;
      try {
        ctx.setTransform(ratio,0,0,ratio,0,0);
        paintCore(ctx,width,height,pose);
      } catch {
        healthy=false;
        delete root.dataset.ready;
        return;
      }
      if (root.dataset.ready !== 'true') root.dataset.ready='true';
      dirty=false;
      if (!paused()) schedule();
    }
    function updateSize() {
      const rect=root.getBoundingClientRect();
      const w=Math.max(0,Math.round(rect.width));
      const h=Math.max(0,Math.round(rect.height));
      if (!w || !h) {
        width=0;
        height=0;
        schedule();
        return;
      }
      const d=Math.min(window.devicePixelRatio || 1,1.65);
      if (w!==width || h!==height || d!==ratio) {
        width=w;height=h;ratio=d;
        canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);
        dirty=true;
      }
      schedule();
    }
    function noteChange() {
      pose.project=root.dataset.project;
      dirty=true;lastFrame=null;
      schedule();
    }
    function setView(yaw,pitch) {
      pose.manual=true;
      targetYaw=clamp(yaw,-0.56,1.90);
      targetPitch=clamp(pitch,0.31,0.82);
      dirty=true;
      schedule();
    }
    canvas.addEventListener('contextlost',event=>{
      event.preventDefault();
      healthy=false;
      delete root.dataset.ready;
      schedule();
    });
    canvas.addEventListener('contextrestored',()=>{
      healthy=true;
      dirty=true;
      lastFrame=null;
      schedule();
    });
    canvas.addEventListener('pointerdown',event=>{
      if (pointer || event.button!==0 || !event.isPrimary) return;
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:targetYaw,pitch:targetPitch};
      if (typeof canvas.setPointerCapture==='function') {
        try {canvas.setPointerCapture(event.pointerId);} catch {pointer=null;return;}
      }
      canvas.dataset.dragging='true';
    });
    canvas.addEventListener('pointermove',event=>{
      if (!pointer || pointer.id!==event.pointerId) return;
      setView(pointer.yaw+(event.clientX-pointer.x)*0.006,
        pointer.pitch-(event.clientY-pointer.y)*0.0034);
    });
    const release=event=>{
      if (!pointer || (event && pointer.id!==event.pointerId)) return;
      const id=pointer.id;
      pointer=null;
      delete canvas.dataset.dragging;
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    };
    canvas.addEventListener('pointerup',release);
    canvas.addEventListener('pointercancel',release);
    canvas.addEventListener('lostpointercapture',release);
    canvas.addEventListener('keydown',event=>{
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      switch (event.key) {
        case 'ArrowLeft': setView(targetYaw-0.13,targetPitch);break;
        case 'ArrowRight': setView(targetYaw+0.13,targetPitch);break;
        case 'ArrowUp': setView(targetYaw,targetPitch+0.065);break;
        case 'ArrowDown': setView(targetYaw,targetPitch-0.065);break;
        case 'Home':
          setView(initialYaw,initialPitch);
          pose.manual=false;
          break;
        default: return;
      }
      event.preventDefault();
    });
    if ('ResizeObserver' in window) new ResizeObserver(updateSize).observe(root);
    window.addEventListener('resize',updateSize,{passive:true});
    const measureIntersection=()=>{
      const box=root.getBoundingClientRect();
      intersecting=box.top<window.innerHeight && box.bottom>0 && box.left<window.innerWidth && box.right>0;
      schedule();
    };
    measureIntersection();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries=>{
        intersecting=entries[0].isIntersecting;
        if (intersecting) {dirty=true;updateSize();}
        schedule();
      }).observe(root);
    } else {
      window.addEventListener('scroll',measureIntersection,{passive:true});
      window.addEventListener('resize',measureIntersection,{passive:true});
    }
    new MutationObserver(noteChange).observe(root,{attributes:true,attributeFilter:['data-project','data-paused','hidden']});
    document.addEventListener('visibilitychange',()=>{dirty=true;schedule();});
    if (motion.addEventListener) motion.addEventListener('change',noteChange);
    else motion.addListener?.(noteChange);
    updateSize();
  }

  document.querySelectorAll('[data-core-scene]').forEach(attachScene);
})();
