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
    const reader = mod.createReader(mod.visualization.data(), mod.visualization.mainTable(), mod.windowSize(), 
        mod.property("myProperty"),
        mod.property("orientation"),
        mod.property("line")
        );

    /**
     * Store the context.
     */
    const context = mod.getRenderContext();

    /**
     * Initiate the read loop
     */
    reader.subscribe(render);

    /**
     * @param {Spotfire.DataView} dataView
     * @param {Spotfire.DataTable} dataTable
     * @param {Spotfire.Size} windowSize
     * @param {Spotfire.ModProperty<string>} prop
     */
    async function render(dataView, dataTable, windowSize, prop, orientation, line) {
        console.log('prop:', prop)
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

            console.log('colorHierarchy:', colorHierarchy)
            console.log('colorLeafNodes:', colorLeafNodes)
            console.log('colorDomain:', colorDomain)

        

        const xLeafNodes = xRoot.leaves();
        const rows = await dataView.allRows()
        const axes = await dataView.axes()
        const arr = rows.map(item => {
            return item.continuous('Y').value()
        })

        let data = []
        let xData = []

        // let rowColors = {}

        let rowColors = xLeafNodes.map((leaf) => {
            var valueAndColorPairs = []
            leaf.rows().forEach((r) => {
                let colorIndex = !colorHierarchy.isEmpty ? r.categorical("Color").leafIndex : 0;
                valueAndColorPairs[colorIndex] = r.color().hexCode;
                // if(!rowColors[leaf.formattedPath()]){
                //     rowColors[leaf.formattedPath()] = {}
                //     rowColors[leaf.formattedPath()].color = r.color().hexCode;
                // }
            });
            var row = [leaf.formattedPath(), ...valueAndColorPairs.flat()];
            return row;
        });

        console.log('dataRows:', rowColors)

        let obj = {}

        rows.forEach(row => {
            data.push(axes.map(axis => {
                if (axis.isCategorical) {
                    return row.categorical(axis.name).formattedValue()
                }
                return row.continuous(axis.name).value()
            }));
        });

        xData = xLeafNodes.map(item => {
            return item.key
        })

        data.forEach(item => {
            if (!obj[item[0]]) {
                obj[item[0]] = []
            } else {
                obj[item[0]].push(item[item.length - 1])
            }
        })

        let res = []

        xData.forEach(x => {
            res.push(obj[x])
        })
        console.log(obj)
        // console.log(res)
        // console.log('data:', data)

        const controls = mod.controls
        const visualization = mod.visualization
        
        // console.log('visualization:', visualization)
        // console.log('xLeafNodes:', xLeafNodes)
        // console.log('rows:', rows)
        // console.log('arr:', arr)

        /**
         * draw echarts
         */

        const styling = context.styling;
        const textStyle = {
            fontSize: styling.scales.font.fontSize,
            fontName: styling.scales.font.fontFamily,
            color: styling.scales.font.color
        };
        let chartDom = document.getElementById('mod-container1');
        let myChart = echarts.init(chartDom);
        let chartData = echarts.dataTool.prepareBoxplotData(res)
        let {boxData, outliers} = chartData
        
        boxData = boxData.map((item, idx) => {
            return {
                value: item,
                itemStyle: {
                    color: rowColors[idx][1],
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

        console.log('outliers:', outliers)
        let option;

        option = {
            title: [],
            tooltip: {
                trigger: 'item',
                axisPointer: {
                    type: 'shadow',
                },
                confine: true,
                formatter: function(params){
                    // console.log(params)

                    let value = params.value;
                    let str = '';
                    if(params.seriesType === 'scatter'){
                        str = `
                            ${params.name}: <br/>
                            ${params.seriesName}: ${value[1].toFixed(4)}<br/>
                       `
                    }else if(params.seriesType === 'boxplot'){
                        let allCount = obj[params.name].length
                        let outArr = []
                        outliers.forEach(item => {
                            if(item[0] === value[0] && item[1]){
                                outArr.push(item[1])
                            }})
                        let outlierCount = outArr.length
                        let count = allCount - outlierCount;
                        str = `
                            ${params.name}<br/>
                            min: ${value[1].toFixed(4)}<br/>
                            Q1: ${value[2].toFixed(4)}<br/>
                            median: ${value[3].toFixed(4)}<br/>
                            Q3: ${value[4].toFixed(4)}<br/>
                            max: ${value[5].toFixed(4)}<br/>
                            count: ${count}<br/>
                            outlierCount: ${outlierCount}<br/>
                            allCount: ${allCount}<br/>
                       `
                    }else if(params.seriesType === 'line'){
                        str = `${params.seriesName}<br/>
                                ${params.name}:  ${params.value[1]}`
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
                bottom: '15%'
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
                splitLine: {
                    show: false,
                }
                
            },
            series: [{
                    name: 'boxplot',
                    type: 'boxplot',
                    // selectedMode: true,
                    // selectedStyle: {

                    // },
                    data: boxData
                },
                {
                    name: 'outlier',
                    type: 'scatter',
                    data: outliers
                }
            ]
        };

        console.log('line:', line)
        formatLineObj(line.value())

        let colorStr = colorDomain.join(',')
        const textWidth = chartDom.clientWidth - 20
        if(colorStr !== 'All Values' && colorStr !== xData.join(',')){
            option = {
                title: [
                    {
                        text: 'All of the color-by columns have to be selected on either the X-axis or used to trellis by.',
                        left: 'center',
                        top: 'center',
                        textStyle: {
                            width: textWidth,
                            fontWeight: 'normal',
                            overflow: 'break',
                            ...textStyle
                        }
                    }
                ],
                series: []
            }
        }

        myChart.clear()

        option && myChart.setOption(option);

        /**
         * Popout change handler
         * @param {Spotfire.PopoutComponentEvent} property
         */
        function popoutChangeHandler({ name, value }) {
            console.log(name, value)
            // name == orientation.name && orientation.set(value);
            name == line.name && line.set(value);
        }

        function formatLineObj(value){
            let map = {}
            let lineMinData = []
            let lineMaxData = []
            const vArr = value.split('-')
            const v = vArr[vArr.length -1]
            if(v === 'none') return;
            outliers.forEach(o => {
                let item = o.value
                if(!Array.isArray(map[item[0]])){
                    map[item[0]] = []
                }
                map[item[0]].push(item[1])
            })
            for(let key in map){
                let data = map[key]
                let idx = data.indexOf(null)
                if(idx > -1){
                    data.splice(idx, 1)
                }

                if(v === 'min'){
                    let min = null
                    if(data && data.length){
                        min = Math.min(...data)
                    }
                    lineMinData.push([Number(key), min])
                }else if(v === 'max'){
                    let max = null
                    if(data && data.length){
                        max = Math.max(...data)
                    }
                    lineMaxData.push([Number(key), max])
                }else if(v === 'all'){
                    let max = null
                    let min = null
                    if(data && data.length){
                        max = Math.max(...data)
                        min = Math.min(...data)
                    }
                    lineMaxData.push([Number(key), max])
                    lineMinData.push([Number(key), min])
                }
            }

            let lineMinObj = {
                type: 'line',
                name: value,
                data: lineMinData
            } 
            let lineMaxObj = {
                type: 'line',
                name: value,
                data: lineMaxData
            }

            option.series.push(lineMinObj)
            option.series.push(lineMaxObj)
            
        }
        /**
         * A helper function to compare a property against a certain value
         */
        const is = (property) => (value) => property.value() == value;

        /**
         * Create a function to show a custom popout
         * Should be called when clicking on chart axes
         */
        const { popout } = mod.controls;
        const { section } = popout;
        const { radioButton } = popout.components;

        function showPopout(e) {
            if (!context.isEditing) {
                return;
            }

            popout.show(
                {
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
                        text: "Line by max",
                        value: "line-by-max",
                        checked: is(line)("line-by-max")
                    }),
                    radioButton({
                        name: line.name,
                        text: "Line by min & max",
                        value: "line-by-all",
                        checked: is(line)("line-by-all")
                    })
                ]
            }),
        ];

        myChart.on('contextmenu', function(e){
            showPopout(e.event.event)
        })

        myChart.on('click', function(e){
            console.log(e)
            xLeafNodes[e.value[0]].rows().forEach(r => r.mark())
        })

        // /**
        //  * Print out to document
        //  */
        // const container = document.querySelector("#mod-container");
        // container.textContent = `windowSize: ${windowSize.width}x${windowSize.height}\r\n`;
        // container.textContent += `should render: ${xRoot.rows().length} rows\r\n`;
        // container.textContent += `${prop.name}: ${prop.value()}`;





        myChart.resize()
        /**
         * Signal that the mod is ready for export.
         */
        context.signalRenderComplete();
    }
});