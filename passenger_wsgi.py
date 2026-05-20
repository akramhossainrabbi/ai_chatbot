import sys
import os

# Add project root to Python path
sys.path.insert(0, os.path.dirname(__file__))

# Import the FastAPI app — Passenger serves it as WSGI via asgiref
from app.main import app

# For cPanel Passenger (WSGI mode), wrap the ASGI app
try:
    from asgiref.wsgi import WsgiToAsgi
    # Passenger expects an 'application' callable
    application = app
except ImportError:
    application = app
