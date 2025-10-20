import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to the HTML file
        html_file_path = os.path.abspath('jules-scratch/verification/kiptify_test.html')

        await page.goto(f'file://{html_file_path}')

        # 1. Test "Save Form"
        await page.hover('form')
        await page.click('.kiptify-trigger')
        await page.click('#kiptify-save-btn')
        await page.wait_for_selector('.kiptify-toast-success')

        # 2. Test "Add custom entry" - Create Blank Entry
        await page.click('#kiptify-add-custom-btn')
        await page.click('#kiptify-create-blank')
        await page.fill('#kiptify-edit-name', 'My Blank Entry')
        await page.click('#kiptify-add-field')
        await page.fill('.kiptify-edit-field-row:last-child .kiptify-edit-label', 'New Label')
        await page.fill('.kiptify-edit-field-row:last-child .kiptify-edit-key', 'new_field')
        await page.fill('.kiptify-edit-field-row:last-child .kiptify-edit-value', 'new_value')
        await page.click('#kiptify-edit-save')
        await page.wait_for_selector('.kiptify-toast-success')
        await page.click('.kiptify-trigger') # Reopen menu to verify

        # 3. Test "Add custom entry" - Create From Current Form
        await page.click('#kiptify-add-custom-btn')
        await page.click('#kiptify-custom-cancel')
        await page.wait_for_selector('.kiptify-modal-overlay', state='hidden')
        await page.click('#kiptify-add-custom-btn')
        await page.check('#kiptify-include-hidden')
        await page.click('#kiptify-create-from-form')
        await page.fill('#kiptify-edit-name', 'My Form Entry With Hidden')
        await page.locator('.kiptify-edit-field-row').first.locator('.kiptify-edit-value').fill('edited_user')
        await page.locator('.kiptify-edit-field-row').first.locator('.kiptify-edit-label').fill('Edited Label')
        await page.click('#kiptify-edit-save')
        await page.wait_for_selector('.kiptify-toast-success')
        await page.click('.kiptify-trigger') # Reopen menu to verify

        # 4. Test field-level CRUD
        await page.click('.kiptify-row:first-child .kiptify-action-btn-edit')
        await page.fill('#kiptify-edit-name', 'Edited Entry Name')
        await page.locator('.kiptify-edit-field-row').first.locator('.kiptify-action-btn-delete').click()
        await page.click('#kiptify-add-field')
        await page.fill('.kiptify-edit-field-row:last-child .kiptify-edit-key', 'another_field')
        await page.fill('.kiptify-edit-field-row:last-child .kiptify-edit-value', 'another_value')
        await page.click('#kiptify-edit-save')
        await page.wait_for_selector('.kiptify-toast-success')

        # 5. Verify storage
        storage = await page.evaluate('window.getGmStorage()')
        print(storage)

        await page.screenshot(path="jules-scratch/verification/verification.png")
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
