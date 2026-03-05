document.addEventListener("DOMContentLoaded", () => {
  // Inicializar el SDK usando RequireJS
  require(["VSS/SDK/Services/ExtensionContext"], function () {
    VSS.init({ usePlatformScripts: true, usePlatformStyles: true });

    VSS.ready(function () {
      console.log("Azure DevOps Extension SDK inicializado");

      const context = VSS.getWebContext();
      const log = document.getElementById("log");
      log.innerHTML += `<div class="meta">Bienvenido ${context.user.name}</div>`;
    });
  });

  const log = document.getElementById("log");
  const inp = document.getElementById("inp");
  const sendBtn = document.getElementById("send");
  const apiUrlInput = document.getElementById("apiUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const saveBtn = document.getElementById("save");

  // Guardar configuración en localStorage
  saveBtn.addEventListener("click", () => {
    localStorage.setItem("apiUrl", apiUrlInput.value);
    localStorage.setItem("apiKey", apiKeyInput.value);
    alert("Configuración guardada en este navegador");
  });

  // Cargar configuración previa
  apiUrlInput.value = localStorage.getItem("apiUrl") || "";
  apiKeyInput.value = localStorage.getItem("apiKey") || "";

  // Función para agregar mensajes al log
  function addMessage(text, type = "u") {
    const div = document.createElement("div");
    div.className = type;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // Enviar mensaje al backend
  async function sendMessage() {
    const msg = inp.value.trim();
    if (!msg) return;

    addMessage("Tú: " + msg, "u");
    inp.value = "";

    try {
      const response = await fetch(apiUrlInput.value, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeyInput.value
        },
        body: JSON.stringify({ prompt: msg })
      });

      if (!response.ok) {
        throw new Error("Error en la petición: " + response.status);
      }

      const data = await response.json();
      addMessage("🤖: " + (data.reply || "Sin respuesta"), "a");
    } catch (err) {
      addMessage("Error: " + err.message, "a");
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Botones rápidos
  document.getElementById("btnPipelines").addEventListener("click", () => {
    inp.value = "Dame el estado de los pipelines";
    sendMessage();
  });

  document.getElementById("btnPRs").addEventListener("click", () => {
    inp.value = "Lista los PRs abiertos";
    sendMessage();
  });
});
