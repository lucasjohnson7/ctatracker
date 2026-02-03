from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QWidget, QVBoxLayout
from PyQt6.QtCore import Qt

import json
from datetime import datetime
import os



class WeatherAndDateSection(QWidget):
    def __init__(self, scale=1.0):
        super().__init__()

        self.scale = scale

        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)

        weather_widget = QWidget()
        self.weather_layout = QVBoxLayout(weather_widget)
        # self.weather_layout.setStyleSheet("background-color: #888; border-radius: 20px;")
        # self.weather_layout.setFixedWidth(500)

        self.weather_label = QLabel("72° Sunny")
        self.weather_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.weather_label.setStyleSheet("font-size: 16px;")
        self.weather_layout.addWidget(self.weather_label, alignment=Qt.AlignmentFlag.AlignCenter)

        date_widget = QWidget()
        self.date_layout = QVBoxLayout(date_widget)
        # self.date_layout.setStyleSheet("background-color: #888; border-radius: 20px;")
        # self.date_layout.setFixedWidth(500)
        
        self.date_label = QLabel("Mon, Dec 22")
        self.date_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.date_label.setStyleSheet("font-size: 16px;")
        self.date_layout.addWidget(self.date_label, alignment=Qt.AlignmentFlag.AlignCenter)
        
        self.layout.addWidget(weather_widget)
        self.layout.addWidget(date_widget)
        
        # Initial update
        self.update()

    def update(self):
        # Update weather and date information here
        now = datetime.now()
        # Formatting date
        formatted_now = str(now.strftime("%a, %b %d"))
        print(formatted_now)
        self.date_label.setText(formatted_now)

        # Fetch weather data from local JSON file
        base_dir = os.path.join(os.path.dirname(__file__), 'data')
        weather_path = os.path.join(base_dir, 'weather.json')
        try:
            with open(weather_path, 'r') as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}
        temp_value = data.get('temperature')
        if isinstance(temp_value, (int, float)):
            temperature = f"{int(round(temp_value))}°"
        else:
            temperature = "N/A"

        self.weather_label.setText(temperature)