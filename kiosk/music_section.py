from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QWidget, QVBoxLayout
from PyQt6.QtCore import Qt

import json
from datetime import datetime

class MusicSection(QWidget):
    def __init__(self, scale=1.0):
        super().__init__()
        self.scale = scale

        self.music_box = QFrame()
        self.music_box.setStyleSheet("background-color: #111; border-radius: 20px;")
        self.music_box.setFixedWidth(500)
        music_layout = QVBoxLayout(self.music_box)
        
        album_art = QLabel("Album Art")
        album_art.setFixedSize(400, 400)
        album_art.setStyleSheet("background-color: #333; border-radius: 10px;")
        album_art.setAlignment(Qt.AlignmentFlag.AlignCenter)

        music_layout.addWidget(album_art, alignment=Qt.AlignmentFlag.AlignCenter)
        music_layout.addWidget(QLabel("Song Title"), alignment=Qt.AlignmentFlag.AlignCenter)
        music_layout.addWidget(QLabel("Artist Name"), alignment=Qt.AlignmentFlag.AlignCenter)

    def update(self):
        pass