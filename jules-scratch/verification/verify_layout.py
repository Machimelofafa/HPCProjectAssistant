import os
from playwright.sync_api import sync_playwright, expect

def run_verification(page):
    # Get the absolute path to the index.html file
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    file_path = os.path.join(base_dir, 'index.html')

    # Navigate to the local HTML file
    page.goto(f'file://{file_path}')

    # Wait for the main application layout to be visible, which indicates loading is complete
    expect(page.locator('#layout')).to_be_visible(timeout=10000)

    # Give it a moment for animations and rendering to settle
    page.wait_for_timeout(1000)

    # Take a screenshot of the initial view
    page.screenshot(path="jules-scratch/verification/verification.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    run_verification(page)
    browser.close()
