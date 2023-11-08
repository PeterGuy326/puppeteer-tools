import puppeteer, { Page } from 'puppeteer'
import { Command, OptionValues } from 'commander'
import moment from 'moment'
import fs from 'fs'
import * as _ from 'lodash'

const main = async () => {
	// 参数解析
	const program = new Command()
	program.option('--username <username>', '用户名').option('--password <password>', '密码').option('--YJ_version <YJ_version>', 'YJ迭代版本，例如YJ-2.8.6')

	program.parse(process.argv)
	const options = program.opts()

	const browser = await puppeteer.launch({ headless: false })
	process.on('SIGINT', function () {
		console.log('进程结束')
		browser.close()
		// 退出程序
		process.exit(0)
	})
	const page = await browser.newPage()

	// 获取当前的提测版本
	const config = fs.readFileSync('../config/submit-test.json', 'utf8')
	const no: number = _.get(JSON.parse(config), options.YJ_version)

	// 登录cf
	await page.goto('https://cf.cloudglab.cn/login.action')
	await page.type('#os_username', `${options.username}`)
	await page.type('#os_password', `${options.password}`)
	await Promise.all([
		page.waitForNavigation(), // 等待页面导航
		page.click('#loginButton'), // 点击提交按钮
	])
	await page.waitForSelector('#logo')
	console.log('cf login success...')
	// const cookies = await page.cookies();

	// 最新的提测页面 url
	const latestTestPageUrl = await getSubmitTestLatestUrl(page, options.YJ_version)

	// 截图
	const filename = await getImage(page, latestTestPageUrl)

	// 禅道提测
	await submitZentaoTest(page, options, no, filename, latestTestPageUrl)

	// 将配置中的提测次数 +1
	const data = JSON.parse(config)
	data[options.YJ_version] = data[options.YJ_version] + 1
	fs.writeFileSync('../config/submit-test.json', JSON.stringify(data))
	console.log(`submit-test content is updated: ${JSON.stringify(data)}`)

	// 删除多余文件
	fs.unlink(`../image/${filename}`, (err) => {
		if (err) throw err
		console.log(`${filename} has been deleted!`)
	})

	browser.close()
}

/**
 * 编写禅道测试单，并且点击提测
 */
const submitZentaoTest = async (page: Page, options: OptionValues, no: number, filename: string, url: string) => {
	// 登录禅道
	await page.goto('https://zentao.cloudglab.cn/user-login-Lw==.html')
	await page.focus('input[name=account]')
	await page.keyboard.type(`${options.username}`)
	await page.focus('input[name=password]')
	await page.keyboard.type(`${options.password}`)
	await Promise.all([
		page.waitForNavigation(), // 等待页面导航
		page.click('#submit'), // 点击提交按钮
	])
	await page.waitForSelector('#menuNav') // 阻塞等待菜单栏出现为止

	// 在禅道创建提测版本
	await Promise.all([
		page.waitForNavigation(), // 等待页面导航
		(await page.$('li[data-id="build"] a'))?.click(),
	])
	await page.click('a[data-app="execution"]') // 点击进入创建版本页面
	await page.waitForSelector('.main-header')
	await page.type('#name', `YJ2.8.6 应用第${no}次提测`)
	await page.click('$submit')

	// 点击左侧栏 测试
	await Promise.all([
		page.waitForNavigation(), // 等待页面导航
		page.click('li[data-app="qa"] a.show-in-app'), // 点击提交按钮
	])
	await page.waitForSelector('li[data-id="testtask"] a')
	await page.click('li[data-id="testtask"] a') // 点击进入测试单列表

	await page.waitForSelector('a[data-app="qa"]')
	await page.click('a[data-app="qa"]') // 点击进入提交测试

	await page.waitForSelector('span')
	await page.evaluate(() => {
		const span = document.querySelector('span')
		if (span) {
			span.title = `YJ2.8.6 应用第${no}次提测`
		}
	})
	const today = moment().format('YYYY-MM-DD')
	const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD')
	await page.type('#begin', today)
	await page.type('#end', tomorrow)
	await page.type('#name', `YJ2.8.6 应用第${no}次提测`)

	// 富文本 具体描述操作
	await page.click('span.ke-outline[data-name="image"]')
	await page.click('li.ke-tabs-li')
	await page.type('#localUrl', `../image/${filename}`)

	await page.focus('.ke-edit-iframe')
	await page.evaluate(() => {
		document.execCommand('insertText', false, `${url}\n`)
	})
	await page.focus('body')

	// 点击加入抄送组
	await page.click('li[data-option-array-index="9"]')
	// await page.click('#submit')

	console.log(`第${no}提测成功了`)
}

/**
 * 获得最新提测版本（还未提测的版本）链接
 * @param page
 */
const getSubmitTestLatestUrl = async (page: Page, YJ_version: string): Promise<string> => {
	await page.goto('https://cf.cloudglab.cn/pages/viewpage.action?pageId=25297225') // 进入 GA - 质量保障 新YJ提测页面
	const YJ_this_version_dev = await page.evaluate((version) => {
		const links = document.querySelectorAll('a')
		for (const link of links) {
			if (link.innerText.includes(version)) {
				return { href: link.href, text: link.innerText }
			}
		}
		return null
	}, YJ_version)
	if (!YJ_this_version_dev) {
		throw new Error(`请先创建${YJ_version}，在新YJ提测页面下`)
	}

	await page.goto(YJ_this_version_dev.href) // 进入提测对应版本页面
	const YJ_this_version_application_dev = await page.evaluate(() => {
		const links = document.querySelectorAll('a')
		for (const link of links) {
			if (link.innerText.includes('应用侧提测')) {
				return { href: link.href, text: link.innerText }
			}
		}
		return null
	})
	if (!YJ_this_version_application_dev) {
		throw new Error(`请在${YJ_version}页面下创建 应用侧提测`)
	}

	await page.goto(YJ_this_version_application_dev.href) // 进入到对应迭代版本的应用侧提测页面
	const custom_content_footer_div = await page.$('#custom-content-footer')
	const links: string[] = []
	if (custom_content_footer_div) {
		const temp = await custom_content_footer_div.$$eval('a', (links) => {
			return links.map((link) => link.href)
		})
		links.push(...temp)
	}

	// 获取当前的提测版本
	const config = fs.readFileSync('../config/submit-test.json', 'utf8')
	const no: number = _.get(JSON.parse(config), YJ_version)
	if (!links.length || no - 1 > links.length) throw new Error('can not find test page')
	console.log(`cf上第${no}的提测页面为${links[no - 1]}`)
	return links[no - 1]
}

/**
 * 对cf对应版本提测页面进行截图
 * @param page
 */
const getImage = async (page: Page, url: string): Promise<string> => {
	const imageFilename = `page-screenshot${moment().valueOf()}.png`
	await page.goto(url)
	await page.click('.expand-collapse-trigger') // 折叠cf的左侧栏

	await page.setViewport({ width: 1920, height: 1080 })
	await page.screenshot({ path: `../image/${imageFilename}`, fullPage: true })
	console.log(`image downloads successfully ${imageFilename}`)
	return imageFilename
}

main()
