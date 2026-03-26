import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorCard } from "./StepCards";
import type { TrajectoryStep } from "../types";

describe("ErrorCard", () => {
  it("should render string error directly", () => {
    const step = {
      errorMessage: "Simple string error message",
    } as unknown as TrajectoryStep;

    render(<ErrorCard step={step} />);

    expect(screen.getByText(/Simple string error message/)).toBeInTheDocument();
    expect(screen.getByText("Agent Error")).toBeInTheDocument();
  });

  it("should render object error and hide full JSON until expanded", () => {
    const errorObj = {
      errorCode: 429,
      userErrorMessage: "Quota exceeded.",
      fullError: "HTTP 429 Resource Exhausted...",
    };
    const step = {
      errorMessage: errorObj,
    } as unknown as TrajectoryStep;

    render(<ErrorCard step={step} />);

    // Should show the title derived from errorCode
    expect(screen.getByText("HTTP 429")).toBeInTheDocument();
    // Should show userErrorMessage
    expect(screen.getByText(/Quota exceeded\./)).toBeInTheDocument();

    // The full output should not be visible initially
    expect(screen.queryByText("HTTP 429 Resource Exhausted...")).not.toBeInTheDocument();

    // Click to expand
    const button = screen.getByRole("button");
    fireEvent.click(button);

    // Now it should be visible
    expect(screen.getByText("HTTP 429 Resource Exhausted...")).toBeInTheDocument();
  });
});
