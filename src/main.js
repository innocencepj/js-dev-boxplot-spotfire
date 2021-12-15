/*
 * Copyright © 2020. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

//@ts-check - Get type warnings from the TypeScript language server. Remove if not wanted.

/**
 * Get access to the Spotfire Mod API by providing a callback to the initialize method.
 * @param {Spotfire.Mod} mod - mod api
 */
Spotfire.initialize(async (mod) => {
    /**
     * Create the read function.
     */
    const reader = mod.createReader(
        mod.visualization.data(), 
        mod.visualization.mainTable(),
        mod.windowSize(),
        mod.property("line"),
        mod.visualization.axis("Y")
    );


    /**
     * Store the context.
     */
    const context = mod.getRenderContext();

    document.body.classList.toggle("editable", context.isEditing);

    /**
     * Initiate the read loop
     */
    reader.subscribe(render);

    /**
     * @param {Spotfire.DataView} dataView
     * @param {Spotfire.DataTable} dataTable
     * @param {Spotfire.Size} windowSize
     */
    async function render(
        dataView,
        dataTable,
        windowSize, 
        line,
        Y
    ) {
        /**
         * Check the data view for errors
         */
        let errors = await dataView.getErrors();
        if (errors.length > 0) {
            // Showing an error overlay will hide the mod iframe.
            // Clear the mod content here to avoid flickering effect of
            // an old configuration when next valid data view is received.
            mod.controls.errorOverlay.show(errors);
            return;
        }
        mod.controls.errorOverlay.hide();

        let chartDom = document.getElementById('mod-container1');
        let myChart = echarts.init(chartDom);
        myChart.clear()

        /**
         * Get the hierarchy of the categorical X-axis.
         */
        const xHierarchy = await dataView.hierarchy("X");
        const xRoot = await xHierarchy.root();

        if (xRoot == null) {
            // User interaction caused the data view to expire.
            // Don't clear the mod content here to avoid flickering.
            return;
        }

        /**
         * Get the color hierarchy.
         */
        const colorHierarchy = await dataView.hierarchy("Color");
        const colorRoot = await colorHierarchy.root();

        const colorLeafNodes = colorRoot.leaves();
        const colorDomain = colorHierarchy.isEmpty ? ["All Values"] :
            colorLeafNodes.map((node) => node.formattedPath());

        // console.log('colorHierarchy:', colorHierarchy)
        // console.log('colorLeafNodes:', colorLeafNodes)
        // console.log('colorDomain:', colorDomain)

        const xLeafNodes = xRoot.leaves();
        const rows = await dataView.allRows()
        const axes = await dataView.axes()
        let data = []
        let xData = []
        /**
         * rowColors: get spotfire set colors
         */
        let rowColors = xLeafNodes.map((leaf) => {
            var valueAndColorPairs = []
            leaf.rows().forEach((r) => {
                let colorIndex = !colorHierarchy.isEmpty ? r.categorical("Color").leafIndex : 0;
                valueAndColorPairs[colorIndex] = r.color().hexCode;
            });
            var row = [leaf.formattedPath(), ...valueAndColorPairs.flat()];
            return row;
        });

        // obj: x Category
        let obj = {}

        rows.forEach(row => {
            data.push(axes.map(axis => {
                if (axis.isCategorical) {
                    return {
                        axisName: axis.name,
                        value: row.categorical(axis.name).formattedValue()
                    }
                }
                return {
                    axisName: axis.name,
                    value: row.continuous(axis.name).value()
                }
            }));
        });

        xData = xLeafNodes.map(item => {
            return generateXData([], item).join(' » ')
        })

        function generateXData(arr, item) {
            if (item.parent && item.parent.key) {
                generateXData(arr, item.parent)
            }
            arr.push(item.key)
            return arr
        }

        let yMap = {}
        data.forEach(item => {
            if (!obj[item[0].value]) {
                obj[item[0].value] = []
            } 
            obj[item[0].value].push(item[1].value)

            let tempArr = item.slice(2, item.length)
            if(!tempArr || !tempArr.length) return;
            tempArr.forEach(a => {
                if(!yMap[a.axisName]){
                    yMap[a.axisName] = []
                }
                yMap[a.axisName].push(a.value)
            })
        })

        // console.log(yMap)


        let res = []

        xData.forEach(x => {
            res.push(obj[x])
        })

        // console.log('xdata:', xData)
        // console.log('data:', data)
        // console.log('obj:', obj)
        // console.log('res:', res)

        /**
         * draw echarts
         */

        const styling = context.styling;
        const textStyle = {
            fontSize: styling.scales.font.fontSize,
            fontName: styling.scales.font.fontFamily,
            color: styling.scales.font.color
        };

        function sum(arr) {
            return arr.reduce((prev, curr) => {
                return prev + curr
            }, 0)
        }

        let chartData = echarts.dataTool.prepareBoxplotData(res)
        let {
            boxData,
            outliers
        } = chartData

        boxData = boxData.map((item, idx) => {
            const avg = Number(sum(res[idx])) / res[idx].length
            const newItem = item.concat([avg])
            return {
                value: newItem,
                itemStyle: {
                    color: "transparent",
                    borderColor: rowColors[idx][1]
                }
            }
        })

        outliers = outliers.map((item, idx) => {
            return {
                value: item,
                itemStyle: {
                    color: rowColors[item[0]][1],
                }
            }
        })

        let option;

        option = {
            title: [],
            tooltip: {
                trigger: 'item',
                axisPointer: {
                    type: 'shadow',
                },
                confine: true,
                formatter: function (params) {
                    let value = params.value;
                    let str = '';
                    if (params.seriesType === 'scatter') {
                        str = `
                            ${params.name}: <br/>
                            ${params.seriesName}: ${value[1].toFixed(4)}<br/>
                       `
                    } else if (params.seriesType === 'boxplot') {
                        let allCount = obj[params.name].length
                        let outArr = []
                        outliers.forEach(item => {
                            if (item[0] === value[0] && item[1]) {
                                outArr.push(item[1])
                            }
                        })
                        let outlierCount = outArr.length
                        let count = allCount - outlierCount;
                        str = `
                            ${params.name}<br/>
                            min: ${value[1].toFixed(4)}<br/>
                            Q1: ${value[2].toFixed(4)}<br/>
                            median: ${value[3].toFixed(4)}<br/>
                            Q3: ${value[4].toFixed(4)}<br/>
                            max: ${value[5].toFixed(4)}<br/>
                            avg: ${value[6].toFixed(4)}<br/>
                            count: ${count}<br/>
                            outlierCount: ${outlierCount}<br/>
                            allCount: ${allCount}<br/>
                       `
                    } else if (params.seriesType === 'line') {
                        str = `${params.seriesName}<br/>
                                ${params.name}:  ${params.value.toFixed(4)}`
                    }

                    return str
                },
                backgroundColor: '#000',
                borderColor: '#000',
                textStyle: {
                    color: '#fff',
                    fontSize: textStyle.fontSize,
                    fontWeight: 'normal',
                    lineHeight: 1,
                }
            },
            grid: {
                left: '10%',
                right: '10%',
                bottom: '20%'
            },
            xAxis: {
                type: 'category',
                boundaryGap: true,
                nameGap: 30,
                splitArea: {
                    show: false
                },
                splitLine: {
                    show: false
                },
                axisLine: {
                    onZero: false,
                },
                axisLabel: {
                    rotate: -90,
                    overflow: 'breakAll'
                },
                data: xData
            },
            yAxis: {
                type: 'value',
                splitArea: {
                    show: false
                },
                axisLine: {
                    show: true,
                },
                axisLabel: {
                    formatter: function(value, index){
                        let arr = (value + '').split('.')
                        if(arr.length > 1 && arr[1].length > 2){
                            return Number(value.toFixed(2))
                        }else{
                            return value
                        }
                    }
                },
                splitLine: {
                    show: false,
                },
                min: function (value) {
                    return Number(parseInt((Math.floor(value.min / 10 * 10) + '')));
                    // return value.min;
                },
                max: function (value) {
                    return value.max
                }

            },
            series: [{
                    name: 'boxplot',
                    type: 'boxplot',
                    data: boxData
                },
                {
                    name: 'outlier',
                    type: 'scatter',
                    data: outliers
                }
            ]
        };
        

        formatLineObj(line.value())
        formatControlLineObj()

        let colorStr = colorDomain.join(',')
        const textWidth = chartDom.clientWidth - 20
        if (colorStr !== 'All Values' && colorStr !== xData.join(',')) {
            option = {
                title: [{
                    text: 'All of the color-by columns have to be selected on either the X-axis or used to trellis by.',
                    left: 'center',
                    top: 'center',
                    textStyle: {
                        width: textWidth,
                        fontWeight: 'normal',
                        overflow: 'break',
                        ...textStyle
                    }
                }],
                series: []
            }
        }

        option && myChart.setOption(option);

        /**
         * format feature line chart
         */
        function formatLineObj(value) {
            let lineData = []
            const features = ['min', 'Q1', 'median', 'Q3', 'max', 'avg']
            const vArr = value.split('-')
            const v = vArr[vArr.length - 1]
            if (v === 'none') return;

            const featureArr = boxData.map(item => {
                return item.value
            })

            lineData = featureArr.map(item => {
                return item[features.indexOf(v)]
            })

            let lineObj = {
                type: 'line',
                name: value,
                label: {
                    show: true,
                    formatter: function(param){
                        return param.value.toFixed(4)
                    },
                    backgroundColor: '#fff',
                },
                data: lineData
            }

            option.series.push(lineObj)

        }


        /**
         * format set line chart
         */
         async function formatControlLineObj() {
            if(yMap && Object.keys(yMap).length){
                for(let key in yMap){
                    let axis = await mod.visualization.axis(key)
                    let lineObj = {
                        type: 'line',
                        name: key,
                        lineStyle: {
                            type: 'dashed'
                        },
                        label: {
                            show: true,
                            formatter: function(param){
                                if(param.dataIndex === 0){
                                    return `${axis.parts[0].displayName}: ${param.value.toFixed(4)}`
                                }else{
                                    return ''
                                }
                            },
                            backgroundColor: '#fff',
                        },
                        symbolSize: 0,
                        data: yMap[key]
                    }
            
                    option.series.push(lineObj)
                }
            }

            option && myChart.setOption(option);
            
        }
        /**
         * A helper function to compare a property against a certain value
         */
        const is = (property) => (value) => property.value() == value;

        /**
         * Create a function to show a custom popout
         * Should be called when clicking on chart axes
         */
        const {
            popout
        } = mod.controls;
        const {
            section
        } = popout;
        const {
            radioButton
        } = popout.components;

        /**
         * Popout change handler
         * @param {Spotfire.PopoutComponentEvent} property
         */
        function popoutChangeHandler({
            name,
            value
        }) {
            // console.log(name, value)
            name == line.name && line.set(value)
        }

        function showPopout(e) {
            if (!context.isEditing) {
                return;
            }

            popout.show({
                    x: e.x,
                    y: e.y,
                    autoClose: true,
                    alignment: "Right",
                    onChange: popoutChangeHandler
                },
                popoutContent
            );
        }


        /**
         * Create popout content
         */
        const popoutContent = () => [
            section({
                heading: "Line Category",
                children: [
                    radioButton({
                        name: line.name,
                        text: "None",
                        value: "none",
                        checked: is(line)("none")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by min",
                        value: "line-by-min",
                        checked: is(line)("line-by-min")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by Q1",
                        value: "line-by-Q1",
                        checked: is(line)("line-by-Q1")
                    }),

                    radioButton({
                        name: line.name,
                        text: "Line by median",
                        value: "line-by-median",
                        checked: is(line)("line-by-median")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by Q3",
                        value: "line-by-Q3",
                        checked: is(line)("line-by-Q3")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by max",
                        value: "line-by-max",
                        checked: is(line)("line-by-max")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by avg",
                        value: "line-by-avg",
                        checked: is(line)("line-by-avg")
                    }),
                ]
            }),

        ];

        myChart.on('contextmenu', function (e) {
            showPopout(e.event.event)
        })

        myChart.on('click', async function (e) {
            const isExpired = await dataView.hasExpired()
            if (isExpired) return;
            xLeafNodes[e.value[0]].rows().forEach(r => {
                r.mark()
            })
        })

        myChart.getZr().on('click', async function (e) {
            if (!e.target) {
                const isExpiredZr = await dataView.hasExpired()
                if(isExpiredZr) return;
                dataView.clearMarking();
            }
        })


        myChart.resize()
        /**
         * Signal that the mod is ready for export.
         */
        context.signalRenderComplete();
    }
});