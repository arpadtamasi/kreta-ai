/** A hosztolt szolgáltatás elérhetősége — nem a profilok Claude-készültsége. */
export function startServiceStatus(): void {
  const indicator = document.querySelector<HTMLElement>("#service-status");
  const label = document.querySelector<HTMLElement>("#service-status-label");
  if (!indicator || !label) return;

  fetch("/health", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("unhealthy");
      indicator.classList.add("online");
      label.textContent = "A szolgáltatás működik";
    })
    .catch(() => {
      indicator.classList.add("offline");
      label.textContent = "A szolgáltatás nem működik";
    });
}
