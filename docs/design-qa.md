# PR-010 design QA

## Verified layouts

The Storybook browser project runs the product stories at these explicit
viewports:

- desktop: 1440 x 900 Firefox;
- tablet: 1024 x 768 Chromium;
- mobile: 390 x 844 Chromium;
- Firefox as a cross-browser baseline.

`src/pages/LandingPage.stories.tsx` verifies that the Git reference controls
stack before the `sm` breakpoint and do not overflow. The receipt, result,
unsupported-state, and launch-asset stories assert the accessible labels and
scope copy used in the design flow.

## Integrated-flow checklist

- Landing: public GitHub URL, Git reference, and profile controls remain
  reachable at desktop, tablet, and mobile widths.
- Result: the final demo scene exposes a textual `PASS` verdict and labels its
  receipt as a sample when no verifiable receipt URL or ID exists.
- Failure: the unsupported state uses its own badge treatment and the system
  error alert uses a WCAG-AA-safe foreground.
- Launch assets: previews use factual public-GitHub/Node-TS scope and remain
  reachable through the Storybook scroll containers at narrow widths.

Run `pnpm test:storybook` for the automated browser QA gate. The CI `check`
workflow also runs this command before the production build.
