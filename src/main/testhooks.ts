export function testEnv(name: `CCSHELL_${string}`): string | undefined {
  return __TEST_HOOKS__ ? process.env[name] : undefined
}
