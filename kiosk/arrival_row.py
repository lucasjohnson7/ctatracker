from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout
from PyQt6.QtCore import Qt

class ArrivalRow(QFrame):
    def __init__(self, index, rn, destination, eta, index_color="#172936", row_color="#62361B", scale=1.0):
        super().__init__()
        
        # Scale dimensions
        row_height = int(180 * scale)
        font_size = int(70 * scale)
        index_font_size = int(20 * scale)
        index_width = int(40 * scale) # Width of the black column
        side_margin = int(50 * scale)

        self.setFixedHeight(row_height)
        # Main container is transparent and has a border
        self.setStyleSheet(f"background: transparent; border: {max(1, int(2*scale))}px solid rgba(0,0,0,1);")
        
        # Main Layout: Holds the Index Box and Content Box side-by-side
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # --- 1. INDEX COLUMN (LEFT BOX) ---
        self.index_frame = QFrame()
        self.index_frame.setFixedWidth(index_width)
        self.index_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {index_color};
                border: none;
            }}
            QLabel {{
                color: white;
                font-family: 'FreeSans';
                font-size: {index_font_size}px;
            }}
        """)
        index_layout = QVBoxLayout(self.index_frame)
        index_layout.setContentsMargins(0, int(8 * scale), 0, 0)
        self.index_label = QLabel(str(index))
        self.index_label.setStyleSheet(f"font-size: {index_font_size}px;")
        # Top-center: horizontally centered, aligned to top of the index column
        self.index_label.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
        index_layout.addWidget(self.index_label)
        index_layout.addStretch()

        # --- 2. DATA COLUMN (RIGHT BOX) ---
        self.data_frame = QFrame()
        self.data_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {row_color};
                border: none;
            }}
            QLabel {{
                color: white;
                font-family: 'FreeSans';
                font-weight: bold;
                font-size: {font_size}px;
            }}
        """)
        
        data_layout = QHBoxLayout(self.data_frame)
        data_layout.setContentsMargins(side_margin, 10, side_margin, 0)

        # Route and destination (left side)
        left_container = QFrame()
        left_container.setStyleSheet("border: none;")
        self.rn_and_dest_layout = QVBoxLayout(left_container)
        self.rn_and_dest_layout.setContentsMargins(0, 0, 0, 0)
        self.rn_and_dest_layout.setSpacing(0)

        self.rn_label = QLabel(f"Route {rn}")
        self.rn_label.setStyleSheet(f"font-size: {int(20 * scale)}px; border: none;")
        self.dest_label = QLabel(destination)
        self.dest_label.setStyleSheet(f"border: none;")

        self.rn_and_dest_layout.addWidget(self.rn_label)
        self.rn_and_dest_layout.addStretch()
        self.rn_and_dest_layout.addWidget(self.dest_label)
        self.rn_and_dest_layout.addStretch()
        
        # Logic for ETA display
        time_str = eta if eta == 'Due' else f"{eta} min"
        self.time_label = QLabel(time_str)
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        data_layout.addWidget(left_container)
        data_layout.addStretch()
        data_layout.addWidget(self.time_label)

        # Add both frames to the main layout
        main_layout.addWidget(self.index_frame)
        main_layout.addWidget(self.data_frame)

    def update_time(self, new_time):
        display_text = new_time if new_time == 'Due' else f"{new_time} min"
        self.time_label.setText(display_text)