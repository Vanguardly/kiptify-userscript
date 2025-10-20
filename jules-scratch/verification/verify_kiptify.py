
import asyncio
from playwright.async_api import async_playwright, TimeoutError
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        page.on('console', lambda msg: print(f"PAGE LOG: {msg.text}"))

        print("Navigating to test page...")
        await page.goto(f'file://{os.path.abspath("jules-scratch/verification/test.html")}')

        # --- Step 1: Fill out the form ---
        print("Filling out the form...")
        await page.fill('#username', 'testuser')
        await page.fill('#password', 'testpass')

        # --- Step 2: Open Kiptify Menu ---
        print("Opening Kiptify menu...")
        await page.hover('#test-form')
        trigger = await page.wait_for_selector('.kiptify-trigger', state='visible')
        await trigger.click()
        await page.wait_for_selector('.kiptify-menu', state='visible')

        # --- Step 3: Save the form state ---
        print("Saving form state...")
        await page.click('#kiptify-save-btn')
        # Wait for the "State saved!" toast to confirm
        await page.wait_for_selector('.kiptify-toast-success:has-text("State saved!")')

        # --- Step 4: Verify the new entry exists ---
        print("Verifying new entry...")
        # The entry name is the timestamp, so we just look for any row
        await page.wait_for_selector('.kiptify-row')

        # --- Step 5: Click the Edit button to trigger the modal ---
        print("Clicking edit button...")
        edit_button = await page.wait_for_selector('.kiptify-action-btn-edit', state='visible')
        await edit_button.click()

        # --- Step 6: Verify the modal and take a screenshot ---
        print("Waiting for edit modal...")
        try:
            await page.wait_for_selector('.kiptify-modal-overlay', state='visible', timeout=5000)
            print("Edit modal is visible.")
            await page.screenshot(path='jules-scratch/verification/kiptify-edit-modal.png')
            print("Screenshot of edit modal saved successfully.")
        except TimeoutError:
            print("ERROR: Timed out waiting for the edit modal.")
            await page.screenshot(path='jules-scratch/verification/kiptify-error.png')
            print("Saved error screenshot to kiptify-error.png")

        await browser.close()
        print("Browser closed.")

if __name__ == '__main__':
    asyncio.run(main())
