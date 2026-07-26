import type { Meta, StoryObj } from "@storybook/react"
import { expect, within } from "storybook/test"
import { LandingPage } from "./LandingPage"
import { AppLayout } from "../components/layout/app-layout"

const meta = {
  title: "Pages/Operational Landing",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <AppLayout>
        <Story />
      </AppLayout>
    ),
  ],
} satisfies Meta<typeof LandingPage>

export default meta
type Story = StoryObj<typeof meta>

export const OperationalLandingDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Check Hero and Heading
    await expect(canvas.getByText("Agent-built software,")).toBeInTheDocument()
    await expect(canvas.getByText("independently verified.")).toBeInTheDocument()

    // Check Header & Attribution
    await expect(canvas.getAllByText("ProofRunner").length).toBeGreaterThan(0)
    await expect(canvas.getAllByText(/by Ever Guild/i).length).toBeGreaterThan(0)

    // Check Hero Links & CTAs
    const verifyCta = canvas.getByRole("link", { name: "Verify a repository" })
    await expect(verifyCta).toBeInTheDocument()
    await expect(verifyCta).toHaveAttribute("href", "#verify")

    const demoReceiptLink = canvas.getByRole("link", { name: "View synthetic demo" })
    await expect(demoReceiptLink).toBeInTheDocument()
    await expect(demoReceiptLink).toHaveAttribute("href", "/examples/passed")
    await expect(canvas.getAllByRole("link", { name: "Synthetic demo" }).length).toBeGreaterThan(0)

    const skillLink = canvas.getByRole("link", { name: /Get the skill file/i })
    await expect(skillLink).toBeInTheDocument()

    // Check Verification Form controls
    const repoUrlInput = canvas.getByLabelText("Repository URL")
    await expect(repoUrlInput).toBeInTheDocument()
    await expect(repoUrlInput).toHaveValue("https://github.com/ever-guild/proof-runner")

    const gitRefSelect = canvas.getByLabelText("Git reference type")
    await expect(gitRefSelect).toBeInTheDocument()

    const gitRefInput = canvas.getByLabelText("Git reference")
    await expect(gitRefInput).toBeInTheDocument()
    const gitRefControls = gitRefInput.parentElement?.parentElement
    await expect(gitRefControls).toHaveClass("grid-cols-1", "sm:grid-cols-[11rem_1fr]")
    await expect(gitRefControls?.scrollWidth).toBeLessThanOrEqual(gitRefControls?.clientWidth ?? 0)

    const profileInput = canvas.getByLabelText("Verification profile")
    await expect(profileInput).toBeInTheDocument()

    const inspectBtn = canvas.getByRole("button", { name: "Inspect repository" })
    await expect(inspectBtn).toBeInTheDocument()

    // Check Sections by headings
    await expect(canvas.getByRole("heading", { name: "How it works" })).toBeInTheDocument()
    await expect(canvas.getByRole("heading", { name: "Regular CI" })).toBeInTheDocument()
    await expect(canvas.getByRole("heading", { name: "Built for agents, not just browsers" })).toBeInTheDocument()
    await expect(canvas.getByRole("heading", { name: "Security & Limitations" })).toBeInTheDocument()
  },
}
