const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const pbjs = require('protobufjs-cli/pbjs')
const pbts = require('protobufjs-cli/pbts')
const { minify } = require('terser')

const protoDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(protoDir, '..')
const sourceProtoPath = path.join(protoDir, 'WAProto.proto')
const tempProtoPath = path.join(protoDir, 'WAProto.codegen.tmp.proto')
const tempTypesJsPath = path.join(protoDir, 'WAProto.types.codegen.tmp.js')
const outputJsPath = path.join(protoDir, 'index.js')
const outputDtsPath = path.join(protoDir, 'index.d.ts')

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`proto generation failed: ${message}`)
    process.exitCode = 1
})

async function main() {
    if (!existsSync(sourceProtoPath)) {
        throw new Error(`missing source proto file at ${sourceProtoPath}`)
    }

    const sourceProto = readFileSync(sourceProtoPath, 'utf8')
    const requiredFieldPattern = /^(\s*)required\s+/gm
    const requiredFieldMatches = sourceProto.match(requiredFieldPattern) ?? []
    const normalizedProto = sourceProto.replace(requiredFieldPattern, '$1optional ')
    let originalJsBytes = 0
    let minifiedJsBytes = 0
    let originalDtsBytes = 0
    let compactDtsBytes = 0

    writeFileSync(tempProtoPath, normalizedProto, 'utf8')

    try {
        const jsOutput = await runCli(pbjs, [
            '--target',
            'static-module',
            '--wrap',
            'commonjs',
            '--no-bundle',
            '--no-beautify',
            '--no-comments',
            '--no-create',
            '--no-convert',
            '--no-delimited',
            '--no-verify',
            '--no-typeurl',
            '--no-service',
            tempProtoPath
        ])

        const minifiedJs = await minify(jsOutput, {
            ecma: 2020,
            compress: {
                defaults: true,
                passes: 3,
                toplevel: true
            },
            mangle: {
                toplevel: true
            },
            format: {
                comments: false
            }
        })

        if (!minifiedJs.code) {
            throw new Error('terser minification returned empty output')
        }

        originalJsBytes = Buffer.byteLength(jsOutput, 'utf8')
        minifiedJsBytes = Buffer.byteLength(minifiedJs.code, 'utf8')

        writeFileSync(outputJsPath, minifiedJs.code, 'utf8')

        const typesJsOutput = await runCli(pbjs, [
            '--target',
            'static-module',
            '--wrap',
            'commonjs',
            '--no-bundle',
            '--no-beautify',
            '--no-create',
            '--no-convert',
            '--no-delimited',
            '--no-verify',
            '--no-typeurl',
            '--no-service',
            tempProtoPath
        ])

        writeFileSync(tempTypesJsPath, typesJsOutput, 'utf8')

        const dtsOutput = await runCli(pbts, ['--no-comments', tempTypesJsPath])
        const compactDtsOutput = toCompactReadableDts(dtsOutput)
        originalDtsBytes = Buffer.byteLength(dtsOutput, 'utf8')
        compactDtsBytes = Buffer.byteLength(compactDtsOutput, 'utf8')
        writeFileSync(outputDtsPath, compactDtsOutput, 'utf8')
    } finally {
        if (existsSync(tempProtoPath)) {
            rmSync(tempProtoPath)
        }
        if (existsSync(tempTypesJsPath)) {
            rmSync(tempTypesJsPath)
        }
    }

    console.log(
        [
            'proto generation completed',
            `required fields normalized: ${requiredFieldMatches.length}`,
            'protobufjs-cli: proto/package.json',
            `js minified: yes`,
            `js size: ${formatBytes(originalJsBytes)} -> ${formatBytes(minifiedJsBytes)}`,
            `d.ts compacted: yes`,
            `d.ts size: ${formatBytes(originalDtsBytes)} -> ${formatBytes(compactDtsBytes)}`,
            `js output: ${path.relative(rootDir, outputJsPath)}`,
            `types output: ${path.relative(rootDir, outputDtsPath)}`
        ].join(' | ')
    )
}

function runCli(cli, args) {
    return new Promise((resolve, reject) => {
        cli.main(args, (error, output) => {
            if (error) {
                reject(error)
                return
            }

            resolve(typeof output === 'string' ? output : '')
        })
    })
}

function formatBytes(bytes) {
    const kb = bytes / 1024
    return `${kb.toFixed(1)} KiB`
}

function toCompactReadableDts(source) {
    return source
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^( {4})+/gm, (indent) => '\t'.repeat(indent.length / 4))
        .replace(/;(?=\n|$)/g, '')
        .replace(/\n{2,}/g, '\n')
}
