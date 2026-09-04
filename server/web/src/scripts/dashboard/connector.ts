/** A Claude-csatlakozó címének másolása. */
export function startConnector(): void {
  const button = document.querySelector<HTMLButtonElement>("#copy-url");
  const urlLabel = document.querySelector<HTMLElement>("#connector-url");
  const copyStatus = document.querySelector<HTMLElement>("#copy-status");
  if (!button || !urlLabel || !copyStatus) return;

  const connectorUrl = new URL("/mcp", window.location.origin).href;
  urlLabel.textContent = connectorUrl;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(connectorUrl);
      copyStatus.textContent = "A cím a vágólapra került.";
      button.textContent = "Másolva";
    } catch {
      copyStatus.textContent = "Jelöld ki és másold ki kézzel a címet.";
    }
  });
}
