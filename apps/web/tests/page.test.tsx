import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "../app/page";

test("identifies Darkstar and makes the preparatory scope explicit", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { name: "Darkstar", level: 1 })).toBeVisible();
  expect(screen.getByText(/Infrastructure only/)).toBeVisible();
});
