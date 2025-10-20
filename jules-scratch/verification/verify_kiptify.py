
import asyncio
from playwright.async_api import async_playwright, TimeoutError
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Listen for console messages
        page.on('console', lambda msg: print(f"PAGE LOG: {msg.text}"))

        print("Navigating to test page...")
        await page.goto(f'file://{os.path.abspath("jules-scratch/verification/test.html")}')
        print("Navigation complete.")

        print("Hovering over the form...")
        await page.hover('#test-form')
        print("Hover complete.")

        try:
            print("Waiting for Kiptify trigger...")
            trigger = await page.wait_for_selector('.kiptify-trigger', state='visible', timeout=5000)
            print("Trigger found and visible.")
            await trigger.click()
            print("Trigger clicked.")
        except TimeoutError:
            print("ERROR: Timed out waiting for the Kiptify trigger to become visible.")
            await browser.close()
            return

        try:
            print("Waiting for Kiptify menu...")
            await page.wait_for_selector('.kiptify-menu', state='visible', timeout=5000)
            print("Menu found and visible.")
        except TimeoutError:
            print("ERROR: Timed out waiting for the Kiptify menu to become visible.")
            # Let's take a screenshot anyway to see the state of the page
            await page.screenshot(path='jules-scratch/verification/kiptify-error.png')
            print("Saved error screenshot to kiptify-error.png")
            await browser.close()
            return

        print("Taking screenshot...")
        await page.screenshot(path='jules-scratch/verification/kiptify-menu.png')
        print("Screenshot saved successfully.")

        await browser.close()
        print("Browser closed.")

if __name__ == '__main__':
    asyncio.run(main())
