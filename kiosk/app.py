import sys
from PyQt6.QtCore import QSize, Qt, QTimer
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QLabel, QFrame, QProgressBar)

from datetime import datetime
from arrival_section import ArrivalSection
from music_section import MusicSection
from weather_and_date import WeatherAndDateSection

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        # self.setFixedSize(QSize(720, 1280))
        # self.setFixedSize(QSize(1080, 1920))

        self.setStyleSheet("background-color: #000000; color: #e6ddff; font-family: FreeSans;")

        # Central Widget & Main Vertical Stack
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        self.main_layout = QVBoxLayout(central_widget)
        self.main_layout.setContentsMargins(0, 0, 0, 0)
        self.main_layout.setSpacing(0)

        # --- 1. HEADER (Timestamp) ---
        self.header = QLabel("9:34 AM")
        self.header.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.header.setStyleSheet("font-size: 12px; color: #888;")
        self.main_layout.addWidget(self.header)

        # --- 2. TRAIN ARRIVAL LISTS (Middle Section) ---
        self.southport_section = ArrivalSection(data_path='./kiosk/data/southport.json', title='Southport Station', row_color="#62361B")
        self.main_layout.addWidget(self.southport_section)

        # --- 3. BUS ARRIVAL LISTS (Middle Section) ---
        self.bus_section = ArrivalSection(data_path='./kiosk/data/77.json', title='Bus Stop #77', row_color="#798491")
        self.main_layout.addWidget(self.bus_section)
        self.main_layout.addStretch()

        # --- 4. BOTTOM ROW (Music + Info Column) ---
        bottom_row = QHBoxLayout()
        bottom_row.setSpacing(40)

        # A. Music Section

        self.music_section = MusicSection(scale=1.0)
        bottom_row.addWidget(self.music_section)
        
        # B. Info Right (Weather/Date + Sports)
        info_right_col = QVBoxLayout()
        
        # Weather & Date (Top of right column)
        top_info = QHBoxLayout()
        self.weather_and_date_section = WeatherAndDateSection(scale=1.0)
        top_info.addWidget(self.weather_and_date_section)

        # Sports Card (Bottom of right column)
        sports_card = QFrame()
        sports_card.setStyleSheet("background-color: #111; border-radius: 20px; padding: 20px;")
        sports_layout = QVBoxLayout(sports_card)
        sports_layout.addWidget(QLabel("CREIGHTON vs VILLANOVA"))
        sports_layout.addWidget(QLabel("BULLS vs LAKERS"))
        
        info_right_col.addLayout(top_info)
        info_right_col.addWidget(sports_card)

        bottom_row.addWidget(self.music_section)
        bottom_row.addLayout(info_right_col)

        self.main_layout.addLayout(bottom_row)

        # --- UPDATE TIMER ---
        self.timer = QTimer(self)

        # Set the interval in ms
        self.timer.setInterval(5000)
        self.timer.timeout.connect(self.update)
        self.timer.start()

    def update(self):
        """ Triggers updates for all dynamics sections """
        self.header.setText(datetime.now().strftime("%I:%M %p"))

        self.southport_section.update()
        self.bus_section.update()
        self.music_section.update()
        self.weather_and_date_section.update()



if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    app.exec()