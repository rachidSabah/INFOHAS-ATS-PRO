# Pull Request

## Summary
<!-- What and why. Link the related issue. -->

## Type of change
- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Docs / chore / release

## Architecture checklist
- [ ] No duplication of the AI pipeline / provider layer / shared memory /
      workflow engine / context manager / Flight Recorder.
- [ ] New AI behavior routes through `ProviderRouter` (no direct adapter call).
- [ ] Cloudflare-compatible (no Node-only APIs in server/edge code).
- [ ] Consumer of existing services, not a re-implementation.

## Validation
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] `npx vitest run` passes
- [ ] `npm run build` succeeds

## Screenshots / evidence (if UI)
<!-- Optional. -->

## Related issue
Closes #
