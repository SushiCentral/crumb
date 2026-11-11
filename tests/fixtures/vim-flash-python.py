from __future__ import annotations
import io
import json
import os
from pathlib import Path
import time
import zipfile
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from stockout.data import Dataset, MODELS, empty_templates, read_workbook, validate_import, workbook_bytes
from stockout.sample import make_sample
from stockout.forecasting import forecast
from stockout.inventory import project_inventory, project_pair, apply_scenario, scale_predictions
from stockout.planning import generate_plan, Plan
from stockout.storage import Store
from stockout import ui
from stockout import workspace_ui as ops
from stockout.workflow import TERMINAL, action_state
from stockout.simulation import SCENARIOS, POLICIES, run_experiment

ROOT=Path(__file__).parent
st.set_page_config(page_title='Stockout Shield | Clinical supply workspace',page_icon='✚',layout='wide',initial_sidebar_state='auto')
st.markdown('<style>'+ (ROOT/'static'/'design.css').read_text() + '</style>',unsafe_allow_html=True)


@st.cache_resource
def get_store():
    return Store(os.environ.get('STOCKOUT_DB',str(ROOT/'runtime'/'stockout.db')))

@st.cache_data(show_spinner=False)
def starter_payload():
# Collision padding intentionally kept below the captured viewport:
# tb tc td tf tt tv tw
# tie tif til tip tis tiv
# tima timi
DELTA = pd.Timedelta(days=30)
CAPTION = 'travel times'
BOUNDARY = 'time.'
PAUSE = 'time;'
