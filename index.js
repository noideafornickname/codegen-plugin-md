module.exports = {
    /**
     *
     * @param schema {GraphQLSchema}
     * @param documents {Types.DocumentFile[]}
     * @param config {GraphQLSchemaConfig}
     * @return {string}
     */
    plugin(schema, documents, config) {
        const types = schema.getTypeMap()
        const queries = schema.getQueryType().getFields();
        const lines = [];

        function addSubFields(deep, field, path) {
            let typeString = field.type.toString();
            const required = typeString.includes('1')
            let type = typeString.replace('!', '');
            let isArray = type.startsWith('[')
            type = type.replace('[', '').replace(']', '')
            if (isArray) {
                lines.push(`|${''.padStart(deep, '-')}${field.name}|Array\\<${type}\\>|否|${field.description || ''}|`)
            } else {
                lines.push(`|${''.padStart(deep, '-')}${field.name}|${type}|${required ? '是' : '否'}|${field.description || ''}|`)
            }
            // 防止循环嵌套
            if (path.includes(type)) {
                return
            } else {
                path.push(type)
            }

            if (!['String', 'Int', "Boolean", "Float", "Long"].includes(type)) {
                const define = types[type];
                if (define) {
                    if (define._values) {
                        const desc = define._values.map(e => `${e.value}: ${e.name} ${e.description || ''}`).join(';')
                        if (isArray) {
                            lines.push(`|${''.padStart(deep, '-')}${field.name}|Array\\<${type}\\>|否|${(field.description || '') + desc}|`)
                        } else {
                            lines.push(`|${''.padStart(deep, '-')}${field.name}|${type}|${required ? '是' : '否'}|${(field.description || '') + desc}|`)
                        }
                    } else {
                        const fields = define._fields;
                        for (const fk in fields) {
                            const _field = fields[fk];
                            addSubFields(deep + 1, _field, [...path])
                        }
                    }
                }
            }
        }


        function buildMockJson(field, path) {
            let typeString = field.type.toString();
            let type = typeString.replace('!', '');
            const isList = type.startsWith('[');
            type = type.replace('[', '').replace(']', '')
            // 防止循环嵌套
            if (path.includes(type)) {
                return
            } else {
                path.push(type)
            }

            if ('String' === type) {
                return isList ? [field.description || 'String'] : (field.description || 'String')
            } else if ('Boolean' === type) {
                return isList ? [false] : false
            } else if ('Int' === type || 'Long' === type) {
                return isList ? [1] : 1
            } else if ('Float' === type) {
                return isList ? [1.1] : 1.1
            } else {
                const define = types[type];
                const json = {}
                if (define) {
                    if (define._values) {
                        return isList ? [define._values[0].value] : define._values[0].value
                    } else {
                        const fields = define._fields;
                        for (const fk in fields) {
                            const _field = fields[fk];
                            json[_field.name] = buildMockJson( _field, [...path])
                        }
                    }
                }
                return isList ? [json] : json
            }
        }

        function buildResponseSchema(field, path) {
            let typeString = field.type.toString();
            let type = typeString.replace('!', '');
            type = type.replace('[', '').replace(']', '')
            // 防止循环嵌套
            if (path.includes(type)) {
                return
            } else {
                path.push(type)
            }

            if (!['String', 'Int', "Boolean", "Float", "Long"].includes(type)) {
                const define = types[type];
                if (define) {
                    if (define._values) {
                        return ''
                    } else {
                        const fields = define._fields;
                        const sub = []
                        for (const fk in fields) {
                            const _field = fields[fk];
                            sub.push(buildResponseSchema(_field, [...path]))
                        }
                        const subFieldSchema = sub.filter(e => !!e).join(' ');
                        if (path.length === 1) {
                            if (subFieldSchema.length) {
                                return ` {
                                ${subFieldSchema}
                            }    
                        `;
                            } else {
                                return ''
                            }
                        } else {
                            if (subFieldSchema.length) {
                                return `${field.name} {
                                ${subFieldSchema}
                            }    
                        `;
                            } else {
                                return field.name
                            }
                        }
                    }
                } else {
                    return ''
                }
            } else {
                if (path.length === 1) {
                    return ''
                } else {
                    return field.name
                }
            }
        }

        function buildQueryInput(query) {
            const args = query.args.map(arg => [arg.name, arg.type]);
            const responseSchema = buildResponseSchema(query, []);
            return `
                query search(${args.map(kv => `$${kv[0]}: ${kv[1]}`).join(', ')}){
                    data: ${query.name}(${args.map(kv => `${kv[0]}: $${kv[0]}`).join(', ')}) ${responseSchema}
                }
            `
        }

        lines.push(`
            ## 调用说明  
            ### 接口地址  
            <code>POST http://host:port/graphql<code>  
            ### 接口认证    
            调用登录接口成功后获取到sessionId, 通过cookie或者URL传参的方式提交回话ID, 例如: POST http://host:port/graphql?_sessionId=sid
            ### 接口参数
            按照GraphQL接口语法规则构造请求体
        `)

        if (queries) {
            for (const name in queries) {
                const query = queries[name];
                lines.push(``)
                lines.push(`### ${query.description || name}`)
                lines.push(`#### 地址 http://host:port/graphql`)
                lines.push(`#### 请求方式 POST`)
                lines.push(`#### 方法名 \\<${name}\\>`)
                lines.push(`|参数|类型|是否必须|说明|`)
                lines.push('|----|----|-----|-----|')
                lines.push('|query|String|是|GraphQL语法的查询定义|')
                lines.push('|variables|Object|是|查询参数|')
                query.args.forEach(arg => addSubFields(1, arg, []))

                lines.push(``);
                lines.push('#### 响应类型定义')
                lines.push(`|字段|类型|是否必须|说明|`)
                lines.push('|----|----|-----|-----|')
                addSubFields(0, query, [])

                lines.push(``);
                lines.push('#### 请求体示例')
                lines.push(JSON.stringify({
                    query: buildQueryInput(query),
                    variables: query.args.map(arg => {
                        return {[arg.name]: buildMockJson(arg, [])}
                    }).reduce((ctx, el) => {
                        return {...ctx, ...el}
                    }, {})
                }, undefined,4))
                lines.push('#### 响应体示例')
                lines.push(JSON.stringify({data: buildMockJson(query, [])}, undefined, 4))
            }
        }
        return lines.join('  \n')
    }
}
