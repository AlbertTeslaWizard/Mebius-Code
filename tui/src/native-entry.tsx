import '@opentui/solid/preload';

process.env.MEBIUS_NATIVE_ENTRY = '1';

const { main } = await import('./cli');
await main();
