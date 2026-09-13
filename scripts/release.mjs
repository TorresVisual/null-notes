export function updateTauriConf(content, version) {
  const json = JSON.parse(content)
  json.version = version
  return JSON.stringify(json, null, 2) + '\n'
}

export function updateCargoToml(content, version) {
  return content.replace(/^version = ".*"$/m, `version = "${version}"`)
}
