import type { Meta, StoryObj } from "@storybook/react"
import { expect, waitFor, within } from "storybook/test"
import { RunPage } from "./RunPage"

const meta = {
  title: "Pages/Run demo",
  component: RunPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof RunPage>

export default meta
type Story = StoryObj<typeof meta>

export const CompletesAndExposesReceipt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(
      () => expect(canvas.getByRole("link", { name: "View demo details" })).toBeVisible(),
      { timeout: 15_000 },
    )
    await expect(canvas.getByText("Demo verdict: PASS")).toBeInTheDocument()
    await expect(canvas.getByText("Demo progress")).toBeInTheDocument()
    await expect(canvas.queryByText("Elapsed")).not.toBeInTheDocument()
    await expect(canvas.queryByText(/00:\d{2}s|45s/)).not.toBeInTheDocument()
  },
}
