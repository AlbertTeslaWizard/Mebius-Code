import { configureBundledOpenTuiRuntime, formatBundledOpenTuiRuntimeDiagnostic } from './nativeRuntime';

process.env.MEBIUS_NATIVE_ENTRY = '1';

const runtimeDiagnostic = await configureBundledOpenTuiRuntime();
if (!runtimeDiagnostic.ok) {
  console.warn(`OpenTUI bundled runtime check failed: ${formatBundledOpenTuiRuntimeDiagnostic(runtimeDiagnostic)}`);
}

await import('@opentui/solid/preload');
const { main } = await import('./cli');
await main();
