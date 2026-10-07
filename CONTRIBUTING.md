# Contributing to Floration

## Versioning

Every pull request raises the patch number by one: 0.2.0, then 0.2.1, 0.2.2 and so on. Run this once on your branch before opening the PR:

```
npm run bump
```

It updates the root `package.json`, every workspace package and `package-lock.json` together, so they always share one version. The app shows that version on its welcome screen. If `main` moves past your version before you merge, run it again after merging `main` so your PR still ends one above it.

Minor and major numbers change only when the owner asks for it.
