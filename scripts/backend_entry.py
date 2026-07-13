"""PyInstaller entry point for the bundled local API engine."""

from multiprocessing import freeze_support

from anki_helper.backend import main


if __name__ == "__main__":
    freeze_support()
    main()
