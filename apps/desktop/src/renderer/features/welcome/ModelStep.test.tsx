import { createTranslator } from "@pibot/i18n";
import type { Task } from "@pibot/models/ui";
import { CHATGPT_PLAN_PROVIDER, type ModelInfo, type Provider } from "@pibot/protocol";
import { SetupError } from "@pibot/renderer-kit";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";
import { ModelStep, type ModelStepStatus } from "./ModelStep.tsx";

const t = createTranslator("en");
const plan: Provider = {
  id: CHATGPT_PLAN_PROVIDER,
  name: "ChatGPT plan",
  group: "subscription",
  auth: "oauth",
  modelCount: 1,
  configured: true,
  envDetected: false,
  available: true,
  chatgpt: { available: true, state: "connected" },
};
const gateway: Provider = {
  ...plan,
  id: "openrouter",
  name: "OpenRouter",
  group: "gateway",
  auth: "apiKey",
  configured: false,
  chatgpt: undefined,
};
const model: ModelInfo = {
  provider: plan.id,
  id: "test-model",
  name: "Test model",
  contextWindow: 32_000,
  input: ["text"],
  reasoning: false,
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
};
const fixture = {
  peer: {
    call: async (method: string) => {
      if (method === "providers.list") return [gateway, plan];
      if (method === "models.list") return [model];
      if (method === "local.detectOllama") return { running: false, models: [] };
      throw new Error(`Unexpected RPC: ${method}`);
    },
  },
};

vi.mock("../../../../../../packages/renderer-kit/src/rpc/context.ts", async (original) => ({
  ...(await original<object>()),
  useRpc: () => ({ peer: fixture.peer }),
  useRpcEvent: () => {},
}));
vi.mock("../../../../../../packages/renderer-kit/src/settings/context.ts", async (original) => ({
  ...(await original<object>()),
  useSettings: () => ({ language: "en", t }),
  useT: () => t,
}));
vi.mock("@pibot/models/ui", async (original) => ({
  ...(await original<object>()),
  ProviderForm: ({ task }: { task: Task }) => (
    <button
      type="button"
      onClick={() =>
        void task.run(async () => {
          throw new SetupError("errors.provider_rejected");
        })
      }
    >
      Test provider
    </button>
  ),
  ChatGPTSignIn: () => null,
}));
vi.mock("@pibot/ui", async (original) => ({
  ...(await original<object>()),
  Combobox: (props: import("@pibot/ui").ComboboxProps) => (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onValueChange(JSON.stringify([plan.id, model.id]))}
    >
      Select model
    </button>
  ),
}));

it("lets onboarding continue after switching away from a failed provider test", async () => {
  const { window, document } = parseHTML("<html><body><div></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.querySelector("div");
  assert(container);
  const root = createRoot(container);
  let status: ModelStepStatus | undefined;
  const error = t("errors.provider_rejected");
  const click = async (text: string) =>
    act(async () => {
      const button = [...container.querySelectorAll("button")].find(
        (element) => element.textContent === text,
      );
      assert(button);
      button.click();
    });

  try {
    await act(async () => {
      root.render(
        <ModelStep
          ref={null}
          onStatus={(value) => {
            status = value;
          }}
          onBack={() => {}}
          onContinue={() => {}}
        />,
      );
    });
    await click("Test provider");
    expect(container.textContent).toContain(error);
    expect(status?.ready).toBe(false);

    await act(async () => {
      const radio = container.querySelector<HTMLInputElement>('input[value="chatgpt"]');
      assert(radio);
      radio.checked = true;
      radio.click();
    });
    await click("Select model");
    expect(container.textContent).not.toContain(error);
    expect(status?.ready).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
