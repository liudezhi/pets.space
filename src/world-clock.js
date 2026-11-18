// 栖光谷 uses China Standard Time and the latitude of its fictional temperate valley.
const zoneOffset = 8 * 3600_000;
const dayLength = 86400_000;
const latitude = 36 * Math.PI / 180;
const tau = Math.PI * 2;
const monthSeasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const seasonalWeather = {
  spring: ['clear','clear','rain','clear','wind','rain','clear','storm'],
  summer: ['clear','wind','clear','storm','clear','rain','clear','clear'],
  autumn: ['clear','clear','wind','clear','rain','clear','clear','wind'],
  winter: ['clear','snow','clear','wind','snow','clear','clear','snow'],
};

export function gardenClimate(prefs = {}, now = Date.now()) {
  const local = new Date(now + zoneOffset);
  const month = local.getUTCMonth();
  const season = Object.hasOwn(seasonalWeather,prefs.season) ? prefs.season : monthSeasons[month];
  const dayOfYear = (Date.UTC(local.getUTCFullYear(), month, local.getUTCDate()) - Date.UTC(local.getUTCFullYear(), 0, 0)) / dayLength;
  const declination = .4091 * Math.sin(tau * (dayOfYear - 81) / 365.2422);
  const halfDay = Math.acos(-Math.tan(latitude) * Math.tan(declination)) * 24 / tau;
  const fixedHours = { dawn: 12 - halfDay + .22, day: 12.8, sunset: 12 + halfDay - .22, night: 23 };
  const hour = Object.hasOwn(fixedHours, prefs.time) ? fixedHours[prefs.time] : (local.getUTCHours() + local.getUTCMinutes()/60 + local.getUTCSeconds()/3600);
  const angle = (hour - 12) * tau / 24;
  const cosD = Math.cos(declination);
  const sun = [-cosD * Math.sin(angle), Math.sin(latitude)*Math.sin(declination) + Math.cos(latitude)*cosD*Math.cos(angle),
    Math.sin(latitude)*cosD*Math.cos(angle) - Math.cos(latitude)*Math.sin(declination)];
  // A shared six-hour weather block is deterministic across visitors and refreshes.
  const block = Math.floor((now + zoneOffset) / 21600_000);
  const hash = Math.imul(block ^ (block >>> 7), 0x45d9f3b) >>> 0;
  const weather = ['clear','wind','rain','snow','storm'].includes(prefs.weather) ? prefs.weather : seasonalWeather[season][(hash ^ hash >>> 16) & 7];
  const moonAge = (((now - Date.UTC(2000,0,6,18,14)) / dayLength / 29.53059) % 1 + 1) % 1;
  const moonAngle = angle - moonAge * tau;
  const moon = [-Math.sin(moonAngle), Math.cos(latitude)*Math.cos(moonAngle), Math.sin(latitude)*Math.cos(moonAngle)];
  return {hour, season, weather, sun, moon, moonAge};
}
