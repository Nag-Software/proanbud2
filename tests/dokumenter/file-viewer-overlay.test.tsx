// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FileViewerOverlay } from "../../components/file-viewer-overlay"

// Vitest kjører uten globals, så Testing Library rydder ikke selv.
afterEach(cleanup)

const URL = "https://example.test/bilde.jpg"

describe("FileViewerOverlay (mobil bildeviser)", () => {
  it("viser bildet med navn og en tydelig Lukk-knapp", () => {
    render(<FileViewerOverlay name="Befaring stue.jpg" url={URL} onClose={() => {}} />)
    expect(screen.getByRole("dialog", { name: "Befaring stue.jpg" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "Befaring stue.jpg" }).getAttribute("src")).toBe(URL)
    expect(screen.getByRole("button", { name: "Lukk" })).toBeTruthy()
  })

  it("Lukk-knappen og Escape lukker begge", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FileViewerOverlay name="a.png" url={URL} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "Lukk" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("låser rulling på siden under mens den er åpen", () => {
    const { unmount } = render(<FileViewerOverlay name="a.png" url={URL} onClose={() => {}} />)
    expect(document.body.style.overflow).toBe("hidden")
    unmount()
    expect(document.body.style.overflow).toBe("")
  })
})
