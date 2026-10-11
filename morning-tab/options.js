const $ = (id) => document.getElementById(id);
chrome.storage.local.get(["apiKey", "model", "days"], (s) => {
  $("key").value = s.apiKey || "";
  $("model").value = s.model || "claude-sonnet-5-5";
  $("days").value = s.days || 7;
});
$("save").onclick = () => {
  chrome.storage.local.set(
    {
      apiKey: $("key").value.trim(),
      model: $("model").value.trim() || "claude-sonnet-5-5",
      days: Math.min(30, Math.max(1, +$("days").value || 7)),
    },
    () => {
      $("msg").textContent = "Saved.";
      setTimeout(() => ($("msg").textContent = ""), 1500);
    }
  );
};
