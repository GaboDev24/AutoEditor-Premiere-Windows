# AutoEditor-Premiere

Sistema de edición de video asistido por IA para Adobe Premiere Pro. Utiliza un LLM como orquestador para analizar videos de ejemplo y replicar su estilo de edición (ritmo de cortes, corrección de color, transiciones) en material bruto nuevo.

---

## Arquitectura

```
/packages
  /mcp-server       TypeScript - Servidor MCP que expone las herramientas de Premiere Pro
  /uxp-panel        TypeScript - Plugin de Adobe UXP que se ejecuta dentro de Premiere
  /orchestrator     TypeScript - Orquestador LLM e interfaz de línea de comandos (CLI)
/services
  /style-analysis   Python - Servicio FastAPI para el análisis de video y audio
/docs
  uxp-compatibility.md
  extendscript-fallbacks.md
```

---

## Requisitos

- Node.js >= 18
- pnpm >= 8
- Python >= 3.10
- Adobe Premiere Pro 2021 (v21.0) o superior
- ffmpeg instalado y disponible en el PATH

---

## Ejecución en Desarrollo

### 1. Instalar dependencias de Node.js

```bash
pnpm install
```

### 2. Iniciar el servicio de Análisis de Estilo en Python

```bash
cd services/style-analysis
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

El servicio estará disponible en `http://localhost:8001`.

### 3. Iniciar el servidor MCP

```bash
pnpm --filter mcp-server dev
```

El servidor MCP se ejecuta sobre `stdio` por defecto (para usar con Antigravity/Claude Code) o en un socket TCP si se establece `MCP_TRANSPORT=tcp`.

### 4. Cargar el panel UXP en Premiere Pro (Modo Desarrollador)

1. Descarga e instala la [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/devtool/).
2. Abre Premiere Pro.
3. En la herramienta UXP Developer Tool, haz clic en **Add Plugin** y selecciona `packages/uxp-panel/manifest.json`.
4. Haz clic en **Load** para cargar el panel en Premiere Pro.

> Para las versiones de Premiere Pro 2021-2022 (v21.x - v22.x): el sistema utilizará automáticamente la comunicación vía CEP/ExtendScript como fallback. No se requieren pasos adicionales.
> Para Premiere Pro 2023 (v23.x): soporte parcial de UXP. El puente selecciona qué ruta usar para cada operación.
> Para Premiere Pro 2025+ (v25.2+): se utiliza UXP de forma completa donde esté disponible.

### 5. Iniciar el orquestador (CLI)

```bash
# Configura el backend LLM preferido
export LLM_BACKEND=claude        # claude | gemini | ollama
export ANTHROPIC_API_KEY=...     # si usas claude
export GEMINI_API_KEY=...        # si usas gemini
export OLLAMA_MODEL=llama3       # si usas ollama

pnpm --filter orchestrator dev
```

---

## Variables de Entorno

| Variable | Valores | Descripción |
|---|---|---|
| `LLM_BACKEND` | `claude`, `gemini`, `ollama` | Proveedor LLM a utilizar |
| `ANTHROPIC_API_KEY` | string | API key para Anthropic Claude |
| `GEMINI_API_KEY` | string | API key para Google Gemini |
| `OLLAMA_BASE_URL` | URL | URL base de Ollama (por defecto: `http://localhost:11434`) |
| `OLLAMA_MODEL` | string | Nombre del modelo para Ollama |
| `STYLE_ANALYSIS_URL` | URL | URL del servicio Python (por defecto: `http://localhost:8001`) |
| `MCP_TRANSPORT` | `stdio`, `tcp` | Transporte para el servidor MCP (por defecto: `stdio`) |
| `MCP_PORT` | number | Puerto para el servidor MCP al usar TCP (por defecto: `3100`) |

---

## Compatibilidad con Premiere Pro

| Versión | Año | Modo Bridge |
|---|---|---|
| v21.x | 2021 | CEP + ExtendScript |
| v22.x | 2022 | CEP + ExtendScript |
| v23.x | 2023 | CEP + ExtendScript (UXP para operaciones limitadas) |
| v24.x | 2024 | CEP + ExtendScript (UXP para operaciones limitadas) |
| v25.2+ | 2025+ | UXP preferido, fallback a ExtendScript para operaciones no soportadas |

---

## Flujo del MVP

1. Abre Premiere Pro con un proyecto que contenga clips.
2. Carga el panel UXP o la extensión CEP según la versión de Premiere.
3. Inicia el servicio Python y el servidor MCP.
4. Conéctate vía Antigravity o Claude Code con el servidor MCP.
5. Escribe un prompt como: `Corta estos clips siguiendo el ritmo de la canción`.
6. El orquestador analiza el audio en busca de beats, luego llama a las herramientas de timeline de MCP para hacer los cortes en cada beat.

---

## Licencia

MIT
