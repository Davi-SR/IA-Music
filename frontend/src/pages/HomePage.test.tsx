import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

describe("HomePage", () => {
  it("renders file and YouTube capabilities in the initial React tree", () => {
    render(<HomePage />);
    expect(screen.getByRole("tab", { name: /arquivo/i })).toBeVisible();
    expect(screen.getByRole("tab", { name: /youtube/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /selecionar arquivo/i })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /youtube/i }));
    expect(screen.getByLabelText(/url do youtube/i)).toBeVisible();
  });

  it("keeps only Home and Minhas Músicas in the primary navigation", () => {
    render(<HomePage />);
    const navigation = screen.getByRole("navigation", { name: /principal/i });
    expect(navigation.querySelectorAll(".nav-links a")).toHaveLength(2);
  });
});
