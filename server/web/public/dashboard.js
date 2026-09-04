const connectorUrl = new URL("/mcp", window.location.origin).href;
const button = document.querySelector("#copy-url");
const connectorUrlLabel = document.querySelector(".url-row code");
const copyStatus = document.querySelector("#copy-status");
const serviceStatus = document.querySelector("#service-status");
const serviceStatusLabel = document.querySelector("#service-status-label");

if (connectorUrlLabel) connectorUrlLabel.textContent = connectorUrl;

button?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(connectorUrl);
    copyStatus.textContent = "A cím a vágólapra került.";
    button.textContent = "Másolva";
  } catch {
    copyStatus.textContent = "Jelöld ki és másold ki kézzel a címet.";
  }
});

fetch("/health", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error();
    serviceStatus.classList.add("online");
    serviceStatusLabel.textContent = "Elérhető";
  })
  .catch(() => {
    serviceStatus.classList.add("offline");
    serviceStatusLabel.textContent = "Nem elérhető";
  });
