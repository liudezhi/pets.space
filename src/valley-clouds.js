// Shared by the skydome and the river: reflected cloud shapes follow the same azimuth,
// time and weather as the sky above the visitor.
export const cloudShader = /* glsl */ `
  vec3 skyWithClouds(vec3 base, vec3 d, vec3 sun, vec3 zenith, vec3 cloudTint,
                     float cover, float day, float clock, sampler2D atlas) {
    float h = max(d.y, 0.);
    float facingSun = pow(max(dot(d, sun), 0.), 6.);
    float dusk = 1. - smoothstep(.0, .39, abs(sun.y));
    vec2 uv = vec2(atan(d.z, d.x) / 3.14159265 + .31 + clock * .00009,
                   asin(clamp(h, 0., 1.)) / 1.18);
    vec3 plate = texture2D(atlas, uv).rgb;
    // The red / blue ratio distinguishes the neutral cloud plate from open blue sky.
    float edge = smoothstep(.17, .95, plate.r / max(.035, plate.b));
    float body = smoothstep(.16, .92, dot(plate, vec3(.21, .72, .07)));
    float overcast = smoothstep(.38, 1., cover);
    float mask = mix(edge, .58 + .42 * edge, overcast) * smoothstep(-.035, .055, d.y);
    mask *= 1. - .72 * smoothstep(.83, 1., h);
    vec3 shadow = cloudTint * mix(.48, .68, day) + zenith * .16;
    vec3 lit = cloudTint * (1.10 + .16 * facingSun) + vec3(.70, .19, .045) * facingSun * dusk * day;
    return mix(base, mix(shadow, lit, pow(body, .78)), mask * .94);
  }
`;
