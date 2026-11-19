// The same cached depth map serves both qualities. Hardware comparison already filters
// four neighboring depths in one lookup. Keep Three's wider kernel for close inspection.
const shadowFunctions = `
#if defined(USE_SHADOWMAP) && defined(SHADOWMAP_TYPE_PCF)
  #define getShadow fullGardenShadow
#endif
#include <shadowmap_pars_fragment>
#if defined(USE_SHADOWMAP) && defined(SHADOWMAP_TYPE_PCF)
  #undef getShadow
  uniform bool wideShadowFilter;
  float getShadow(sampler2DShadow shadowMap, vec2 size, float intensity,
                  float bias, float radius, vec4 coord) {
    if (wideShadowFilter) return fullGardenShadow(shadowMap, size, intensity, bias, radius, coord);
    vec3 uvz = coord.xyz / coord.w;
    #ifdef USE_REVERSED_DEPTH_BUFFER
      uvz.z -= bias;
    #else
      uvz.z += bias;
    #endif
    if (uvz.z > 1. || any(lessThan(uvz.xy, vec2(0.))) || any(greaterThan(uvz.xy, vec2(1.)))) return 1.;
    return mix(1., texture(shadowMap, uvz), intensity);
  }
#endif`;

export function shadowFilter(group) {
  const wide = { value: true };
  const materials = new Set();
  group.traverse(object => {
    if (!object.receiveShadow || !object.material) return;
    for (const material of [].concat(object.material)) materials.add(material);
  });
  for (const material of materials) {
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
      previous.call(this, shader, renderer);
      shader.uniforms.wideShadowFilter = wide;
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', shadowFunctions);
    };
    material.customProgramCacheKey = () => previousKey + '/garden-shadow-filter';
  }
  return wide;
}
