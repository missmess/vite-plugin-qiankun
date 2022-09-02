import cheerio, { CheerioAPI, Element } from 'cheerio'
import { PluginOption } from 'vite'

const createQiankunHelper = (qiankunName: string) => `
  const createDeffer = (hookName) => {
    const d = new Promise((resolve, reject) => {
      window.proxy && (window.proxy[\`vite\${hookName}\`] = resolve)
    })
    return props => d.then(fn => fn(props));
  }
  const bootstrap = createDeffer('bootstrap');
  const mount = createDeffer('mount');
  const unmount = createDeffer('unmount');
  const update = createDeffer('update');

  ;(global => {
    global.qiankunName = '${qiankunName}';
    global['${qiankunName}'] = {
      bootstrap,
      mount,
      unmount,
      update
    };
  })(window);
`

// eslint-disable-next-line no-unused-vars
const replaceSomeScript = ($: CheerioAPI, findStr: string, replaceStr: string = '') => {
  $('script').each((i, el) => {
    if ($(el).html()?.includes(findStr)) {
      $(el).html(replaceStr)
    }
  })
}

const createImportFinallyResolve = (qiankunName: string) => {
  return `
    const qiankunLifeCycle = window.moudleQiankunAppLifeCycles && window.moudleQiankunAppLifeCycles['${qiankunName}'];
    if (qiankunLifeCycle) {
      window.proxy.vitemount((props) => qiankunLifeCycle.mount(props));
      window.proxy.viteunmount((props) => qiankunLifeCycle.unmount(props));
      window.proxy.vitebootstrap(() => qiankunLifeCycle.bootstrap());
      window.proxy.viteupdate((props) => qiankunLifeCycle.update(props));
    }
  `
}

// const createImportLinks = (href: string, rel: string | undefined) => {
//   return `
//     let css = document.createElement('link');
//     css.href = ${href};
//     css.rel = '${rel}';
//     document.head.appendChild(css);
//   `
// }

export type MicroOption = {
  useDevMode?: boolean
  urlTransform?: (ori: string) => string;
}
type PluginFn = (qiankunName: string, microOption?: MicroOption) => PluginOption;

const htmlPlugin: PluginFn = (qiankunName, microOption = {}) => {
  let isProduction: boolean
  let base = ''

  const module2DynamicImport = ($: CheerioAPI, scriptTag: Element | undefined) => {
    if (!scriptTag) {
      return
    }
    const script$ = $(scriptTag)
    let moduleSrc = script$.attr('src')
    let appendBase = ''
    // if (microOption.useDevMode && !isProduction) {
    appendBase = '(window.proxy ? (window.proxy.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ + \'..\') : \'\') + '
    // }
    script$.removeAttr('src')
    script$.removeAttr('type')
    if (microOption.urlTransform && moduleSrc) {
      moduleSrc = microOption.urlTransform(moduleSrc)
    }
    script$.html(`import(${appendBase}'${moduleSrc}')`)
    return script$
  }

  // const link2DynamicImport = function ($: CheerioAPI, linkTag: Element) {
  //   if (!linkTag) {
  //     return
  //   }
  //   const link$ = $(linkTag)
  //   let linkHref = link$.attr('href')
  //   const linkRel = link$.attr('rel')
  //   let appendBase = ''
  //   // if (microOption.useDevMode && !isProduction) {
  //   appendBase = '(window.proxy ? (window.proxy.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ + \'..\') : \'\') + '
  //   // }
  //   link$.attr('href', '')
  //   if (microOption.urlTransform && linkHref) {
  //     linkHref = microOption.urlTransform(linkHref)
  //   }
  //   link$.parent().append('<script>' + createImportLinks(appendBase + `'${linkHref}'`, linkRel) + '</script>\n')
  //   return link$
  // }

  return {
    name: 'qiankun-html-transform',
    configResolved (config) {
      isProduction = config.command === 'build' || config.isProduction
      base = config.base
    },

    configureServer (server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          if (isProduction || !microOption.useDevMode) {
            next()
            return
          }
          const end = res.end.bind(res)
          res.end = (...args: any[]) => {
            let [htmlStr, ...rest] = args
            if (typeof htmlStr === 'string') {
              const $ = cheerio.load(htmlStr)
              module2DynamicImport($, $(`script[src=${base}@vite/client]`).get(0))
              htmlStr = $.html()
            }
            return end(htmlStr, ...rest)
          }
          next()
        })
      }
    },
    transformIndexHtml (html: string) {
      const $ = cheerio.load(html)

      // const linkTags = $('link')
      // if (!linkTags || !linkTags.length) {
      //   return
      // }
      // linkTags.each(function (i, linkTag) {
      //   link2DynamicImport($, linkTag)
      // })

      const moduleTags = $('body script[type=module], head script[crossorigin=""]')
      if (!moduleTags || !moduleTags.length) {
        return
      }
      const len = moduleTags.length
      moduleTags.each((i, moduleTag) => {
        const script$ = module2DynamicImport($, moduleTag)
        if (len - 1 === i) {
          script$?.html(`${script$.html()}.finally(() => {
            ${createImportFinallyResolve(qiankunName)}
          })`)
        }
      })

      $('body').append(`<script>${createQiankunHelper(qiankunName)}</script>`)
      const output = $.html()
      return output
    }
  }
}

export default htmlPlugin
