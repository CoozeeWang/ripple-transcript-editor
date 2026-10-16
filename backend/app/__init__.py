"""Initialize dependencies before any packaged backend or MCP entry point imports them."""
from .bundled_runtime import initialize_packages

initialize_packages()
