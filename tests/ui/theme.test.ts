import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ThemeProvider } from "@/app/theme";
import { GeneralSettings } from "@/features/settings/general-settings";

let media: MediaQueryList;
let changes: EventTarget;
let systemDark: boolean;
const addListener = vi.fn<MediaQueryList["addEventListener"]>();
const removeListener = vi.fn<MediaQueryList["removeEventListener"]>();

function changeSystem(dark: boolean) {
  systemDark = dark;
  changes.dispatchEvent(new Event("change"));
}

function mount() {
  return render(
    createElement(
      StrictMode,
      null,
      createElement(ThemeProvider, null, createElement(GeneralSettings)),
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  changes = new EventTarget();
  addListener.mockImplementation(changes.addEventListener.bind(changes));
  removeListener.mockImplementation(changes.removeEventListener.bind(changes));
  media = {
    get matches() {
      return systemDark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: addListener,
    removeEventListener: removeListener,
    dispatchEvent: changes.dispatchEvent.bind(changes),
    addListener: vi.fn<MediaQueryList["addListener"]>(),
    removeListener: vi.fn<MediaQueryList["removeListener"]>(),
  };
  vi.stubGlobal("matchMedia", () => media);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("theme settings", () => {
  it("defaults to system and follows live changes in both directions", () => {
    systemDark = true;
    mount();
    expect((screen.getByRole("combobox", { name: "主题" }) as HTMLSelectElement).value).toBe(
      "system",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    changeSystem(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    changeSystem(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies and remembers explicit choices without following system changes", () => {
    const view = mount();
    const select = screen.getByRole("combobox", { name: "主题" });
    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    changeSystem(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    view.unmount();
    mount();
    expect((screen.getByRole("combobox", { name: "主题" }) as HTMLSelectElement).value).toBe(
      "dark",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "light" },
    });
    expect(localStorage.getItem("agentchat.theme")).toBe("light");
    changeSystem(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "system" },
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    changeSystem(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to system for invalid stored preferences", () => {
    localStorage.setItem("agentchat.theme", "invalid");
    systemDark = true;
    mount();
    expect((screen.getByRole("combobox", { name: "主题" }) as HTMLSelectElement).value).toBe(
      "system",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("still applies the theme and reports when persistence is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      clear: () => undefined,
    });
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "dark" } });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("无法保存偏好");
  });

  it("cleans up the system listener on unmount", () => {
    const view = mount();
    view.unmount();
    expect(removeListener).toHaveBeenCalledTimes(addListener.mock.calls.length);
    changeSystem(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
