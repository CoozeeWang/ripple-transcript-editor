"""Reviewed provider information and explicit official-document checks only."""
from fastapi import APIRouter

from . import audio_rules

router = APIRouter(prefix='/api/audio')

@router.get('/rules/{provider}')
def get_rules(provider: str):
    return audio_rules.rules(provider)

@router.post('/rules/{provider}/refresh')
def refresh_rules(provider: str):
    return audio_rules.refresh(provider)
