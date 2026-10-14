# Smolov SBD project rules

- Host this PWA on GitHub Pages at https://lordofblackwood.github.io/smolov-sbd/ using the existing `.github/workflows/pages.yml` deployment. The source repository is https://github.com/lordofblackwood/smolov-sbd.
- Sites is only the existing Powerlevel encrypted-history connector at https://powerlevel-sync.micak27.chatgpt.site. Do not register or publish the PWA frontend through Sites. The earlier tracker Sites address is only a legacy data-recovery page.
- Preserve the supplied Modified Smolov Jr. SBD schedule, original confirmed training max rules, per-workout target snapshots, and meet date November 15, 2026 in America/New_York. Do not redesign the training.
- Use the existing supported Powerlevel contract and authentication. Never submit synthetic/test workouts to live accounts, create duplicate exercise IDs, or reimplement scoring.
- Preserve account-scoped local records and the durable outbox. Hosting-origin changes require explicit backup/import; never assume browser-local records move with deployment.
- Test and build with the Pages base path. `BASE_PATH=/smolov-sbd/ npm run build` and `TEST_BASE_PATH=/smolov-sbd/ npm run e2e` verify the deployed shape. A manually started Vite preview also needs `BASE_PATH=/smolov-sbd/`.
