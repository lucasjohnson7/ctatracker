from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QWidget, QVBoxLayout
from PyQt6.QtCore import Qt

import json
from datetime import datetime

from arrival_row import ArrivalRow

class ArrivalSection(QWidget):
    def __init__(self, data_path, title, row_color, row_limit=4, scale=1.0):
        super().__init__()
        self.data_path = data_path
        self.row_color = row_color
        self.row_limit = row_limit
        self.scale = scale
        
        # Main layout for this specific section
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        # no spacing on the main layout; rows live in a separate layout with spacing
        self.layout.setSpacing(0)

        if title:
            header = QLabel(title.upper())
            header.setStyleSheet(f"""
                font-family: 'FreeSans';
                font-weight: bold;
                font-size: {int(35 * scale)}px;
                color: #888;
                padding: {int(20 * scale)}px;
                background-color: #1a1a1a;
            """)
            self.layout.addWidget(header)

        # Container for rows so spacing applies only between rows (not between header and first row)
        self.rows_container = QWidget()
        self.rows_layout = QVBoxLayout(self.rows_container)
        self.rows_layout.setContentsMargins(0, 0, 0, 0)
        # no empty space between rows; visual separation is provided by each row's bottom border
        self.rows_layout.setSpacing(0)
        self.layout.addWidget(self.rows_container)

        # Initial update
        self.update()

    def update(self):
        # clear previous rows from the rows container only
        while self.rows_layout.count():
            item = self.rows_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        with open(self.data_path, 'r') as f:
            data = json.load(f)
        
        for i, arrival in enumerate(data, start=1):
            if i > self.row_limit:
                continue
            rn = arrival.get("rn")
            dest = arrival.get("destNm")
            arr_time_str = arrival.get("arrT")
            is_approaching = arrival.get("isApp")

            arrival_dt = datetime.fromisoformat(arr_time_str)
            if is_approaching:
                eta = 'Due'
            else:
                diff = arrival_dt - datetime.now()
                eta = str(int(diff.total_seconds() / 60))
            print(f"Destination: {dest} | Time: {arr_time_str} | Due: {is_approaching}")

            row = ArrivalRow(index=i, rn=rn, destination=dest, eta=eta, row_color=self.row_color)
            self.rows_layout.addWidget(row)