import cockpit from "cockpit";
import React from "react";
import { log_cmd } from "./lib/tools.jsx";
import { ReplSuffix } from "./lib/replication/replSuffix.jsx";
import { TreeView, noop, Spinner } from "patternfly-react";
import PropTypes from "prop-types";

const treeViewContainerStyles = {
    width: '295px',
};

export class Replication extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            firstLoad: true,
            errObj: {},
            nodes: [],
            node_name: "",
            node_text: "",
            node_type: "",
            node_replicated: false,
            disableTree: true,

            // Suffix
            suffixLoading: false,
            attributes: [],
            role: "",
            rid: "0",
            bindDNs: [],
            bindDNGroup: "",
            agmtRows: [],
            winsyncRows: [],
            ruvRows: [],
            suffixSpinning: false,
            disabled: false,
            clLoading: false,
            clMaxEntries: "",
            clMaxAge: "",
            clTrimInt: "",
            clEncrypt: false,
            suffixKey: 0,

            showDisableConfirm: false,
            loaded: false,
        };

        // General
        this.selectNode = this.selectNode.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.disableTree = this.disableTree.bind(this);
        this.enableTree = this.enableTree.bind(this);

        this.reloadConfig = this.reloadConfig.bind(this);
        this.reloadAgmts = this.reloadAgmts.bind(this);
        this.reloadWinsyncAgmts = this.reloadWinsyncAgmts.bind(this);
        this.reloadRUV = this.reloadRUV.bind(this);
        this.loadAttrs = this.loadAttrs.bind(this);
        this.loadReplSuffix = this.loadReplSuffix.bind(this);
        this.reloadChangelog = this.reloadChangelog.bind(this);
        this.loadSuffixTree = this.loadSuffixTree.bind(this);
    }

    componentDidUpdate(prevProps) {
        if (this.props.wasActiveList.includes(3)) {
            if (this.state.firstLoad) {
                this.loadSuffixTree(true);
                if (!this.state.loaded) {
                    this.loadAttrs();
                }
            } else {
                if (this.props.serverId !== prevProps.serverId) {
                    this.loadSuffixTree(true);
                }
            }
        }
    }

    reloadChangelog () {
        // Refresh the changelog
        this.setState({
            clLoading: true
        });
        let cmd = ['dsconf', '-j', 'ldapi://%2fvar%2frun%2fslapd-' + this.props.serverId + '.socket', 'replication', 'get-changelog'];
        log_cmd("reloadChangelog", "Reload the changelog", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    const config = JSON.parse(content);
                    let clDir = "";
                    let clMaxEntries = "";
                    let clMaxAge = "";
                    let clTrimInt = "";
                    let clEncrypt = false;
                    for (let attr in config['attrs']) {
                        let val = config['attrs'][attr][0];
                        if (attr == "nsslapd-changelogdir") {
                            clDir = val;
                        }
                        if (attr == "nsslapd-changelogmaxentries") {
                            clMaxEntries = val;
                        }
                        if (attr == "nsslapd-changelogmaxage") {
                            clMaxAge = val;
                        }
                        if (attr == "nsslapd-changelogtrim-interval") {
                            clTrimInt = val;
                        }
                        if (attr == "nsslapd-encryptionalgorithm") {
                            clEncrypt = true;
                        }
                    }
                    this.setState({
                        clDir: clDir,
                        clMaxEntries: clMaxEntries,
                        clMaxAge: clMaxAge,
                        clTrimInt: clTrimInt,
                        clEncrypt: clEncrypt,
                        clLoading: false
                    });
                })
                .fail(() => {
                    this.setState({
                        clDir: "",
                        clMaxEntries: "",
                        clMaxAge: "",
                        clTrimInt: "",
                        clEncrypt: false,
                        clLoading: false
                    });
                });
    }

    processBranch(treeBranch) {
        if (treeBranch.length == 0) {
            return;
        }
        for (let sub in treeBranch) {
            if (!treeBranch[sub].type.endsWith("suffix")) {
                // Not a suffix, skip it
                treeBranch.splice(sub, 1);
                continue;
            } else if (treeBranch[sub].replicated) {
                treeBranch[sub].icon = "fa fa-clone";
                treeBranch[sub].replicated = true;
            }
            this.processBranch(treeBranch[sub].nodes);
        }
    }

    loadSuffixTree(fullReset) {
        if (this.state.firstLoad) {
            this.setState({
                firstLoad: false
            });
        }

        this.setState({
            loaded: false
        });

        const cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "backend", "get-tree",
        ];
        log_cmd("loadSuffixTree", "Start building the suffix tree", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    let treeData = [];
                    if (content != "") {
                        treeData = JSON.parse(content);
                    }
                    let basicData = [
                        {
                            text: "Suffixes",
                            icon: "pficon-topology",
                            state: {"expanded": true},
                            selectable: false,
                            id: "repl-suffixes",
                            nodes: []
                        }
                    ];
                    let current_node = this.state.node_name;
                    let current_type = this.state.node_type;
                    let replicated = this.state.node_replicated;
                    if (fullReset && treeData.length > 0) {
                        let found = false;
                        for (let i = 0; i < treeData.length; i++) {
                            if (treeData[i].replicated) {
                                treeData[i].icon = "fa fa-clone";
                                replicated = true;
                                if (!found) {
                                    // Load the first replicated suffix we find
                                    treeData[i].selected = true;
                                    current_node = treeData[i].id;
                                    current_type = treeData[i].type;
                                    this.loadReplSuffix(treeData[i].id);
                                    found = true;
                                }
                            }
                            this.processBranch(treeData[i].nodes);
                        }
                        if (!found) {
                            // No replicated suffixes, load the first one
                            treeData[0].selected = true;
                            current_node = treeData[0].id;
                            current_type = treeData[0].type;
                            this.loadReplSuffix(treeData[0].id);
                        }
                    } else if (treeData.length > 0) {
                        // Reset current suffix
                        for (let suffix of treeData) {
                            this.processBranch(suffix.nodes);
                            if (suffix.id == current_node) {
                                suffix.selected = true;
                                replicated = suffix.replicated;
                            }
                            if (suffix.replicated) {
                                suffix.icon = "fa fa-clone";
                            }
                        }
                        this.loadReplSuffix(current_node);
                    }
                    basicData[0].nodes = treeData;
                    this.setState(() => ({
                        nodes: basicData,
                        node_name: current_node,
                        node_type: current_type,
                        node_replicated: replicated,
                    }), this.update_tree_nodes);
                });
    }

    selectNode(selectedNode) {
        if (selectedNode.selected) {
            return;
        }

        this.setState({
            disableTree: true // Disable the tree to allow node to be fully loaded
        });

        if (selectedNode.id in this.state) {
            // This suffix is already cached, just use what we have...
            this.setState(prevState => {
                return {
                    nodes: this.nodeSelector(prevState.nodes, selectedNode),
                    node_name: selectedNode.id,
                    node_text: selectedNode.text,
                    node_type: selectedNode.type,
                    node_replicated: selectedNode.replicated,
                    disableTree: false,
                    suffixKey: new Date(),
                };
            });
        } else {
            // Suffix/subsuffix
            this.loadReplSuffix(selectedNode.id);
            this.setState(prevState => {
                return {
                    nodes: this.nodeSelector(prevState.nodes, selectedNode),
                    node_name: selectedNode.id,
                    node_text: selectedNode.text,
                    node_type: selectedNode.type,
                    node_replicated: selectedNode.replicated,
                    suffixKey: new Date(),
                };
            });
        }
    }

    nodeSelector(nodes, targetNode) {
        return nodes.map(node => {
            if (node.nodes) {
                return {
                    ...node,
                    nodes: this.nodeSelector(node.nodes, targetNode),
                    selected: node.id === targetNode.id ? !node.selected : false
                };
            } else if (node.id === targetNode.id) {
                return { ...node, selected: !node.selected };
            } else if (node.id !== targetNode.id && node.selected) {
                return { ...node, selected: false };
            } else {
                return node;
            }
        });
    }

    update_tree_nodes() {
        // Set title to the text value of each suffix node.  We need to do this
        // so we can read long suffixes in the UI tree div.  This is the last
        // step of loading the page, so mark it loaded!
        let elements = document.getElementsByClassName('treeitem-row');
        for (let el of elements) {
            el.setAttribute('title', el.innerText);
        }
        this.setState({
            loaded: true
        });
    }

    handleChange(e) {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        let valueErr = false;
        let errObj = this.state.errObj;
        if (value == "") {
            valueErr = true;
        }
        errObj[e.target.id] = valueErr;
        this.setState({
            [e.target.id]: value,
            errObj: errObj
        });
    }

    closeSuffixModal() {
        this.setState({
            showSuffixModal: false
        });
    }

    reloadAgmts (suffix) {
        this.setState({
            suffixSpinning: true,
            disabled: true,
        });
        let cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "repl-agmt", "list", "--suffix", suffix
        ];
        log_cmd("reloadAgmts", "get repl agreements", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    const obj = JSON.parse(content);
                    let rows = [];
                    for (let idx in obj['items']) {
                        let agmt_attrs = obj['items'][idx]['attrs'];
                        let state = "Enabled";
                        let update_status = "";
                        let agmt_init_status = "";

                        // Compute state (enabled by default)
                        if ('nsds5replicaenabled' in agmt_attrs) {
                            if (agmt_attrs['nsds5replicaenabled'][0].toLowerCase() == 'off') {
                                state = "Disabled";
                            }
                        }

                        // Check for status msgs
                        if ('nsds5replicalastupdatestatus' in agmt_attrs) {
                            update_status = agmt_attrs['nsds5replicalastupdatestatus'][0];
                        }
                        if ('nsds5replicalastinitstatus' in agmt_attrs &&
                            agmt_attrs['nsds5replicalastinitstatus'][0] != "") {
                            agmt_init_status = agmt_attrs['nsds5replicalastinitstatus'][0];
                            if (agmt_init_status == "Error (0) Total update in progress" ||
                                agmt_init_status == "Error (0)") {
                                agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                            } else if (agmt_init_status == "Error (0) Total update succeeded") {
                                agmt_init_status = "Initialized";
                                agmt_init_status = <td key={agmt_attrs['cn']}><i>Initialized</i></td>;
                            } else {
                                agmt_init_status = <td key={agmt_attrs['cn']}>{agmt_init_status}</td>;
                            }
                        } else if (agmt_attrs['nsds5replicalastinitstart'][0] == "19700101000000Z") {
                            agmt_init_status = "Not initialized";
                            agmt_init_status = <td key={agmt_attrs['cn']}><i>Not Initialized</i></td>;
                        } else if ('nsds5beginreplicarefresh' in agmt_attrs) {
                            agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                        }

                        // Update table
                        rows.push({
                            'name': agmt_attrs['cn'],
                            'host': agmt_attrs['nsds5replicahost'],
                            'port': agmt_attrs['nsds5replicaport'],
                            'state': [state],
                            'status': [update_status],
                            'initstatus': [agmt_init_status]
                        });
                    }

                    // Set agmt
                    this.setState({
                        [suffix]: {
                            ...this.state[suffix],
                            agmtRows: rows,
                        },
                        suffixSpinning: false,
                        disabled: false,
                    });
                })
                .fail(() => {
                    this.setState({
                        suffixSpinning: false,
                        disabled: false,
                    });
                });
    }

    reloadWinsyncAgmts (suffix) {
        this.setState({
            suffixSpinning: true,
            disabled: true,
        });
        let cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "repl-winsync-agmt", "list", "--suffix", suffix
        ];
        log_cmd("reloadWinsyncAgmts", "Get Winsync Agreements", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    const obj = JSON.parse(content);
                    let ws_rows = [];
                    for (var idx in obj['items']) {
                        let state = "Enabled";
                        let update_status = "";
                        let ws_agmt_init_status = "Initialized";
                        let agmt_attrs = obj['items'][idx]['attrs'];
                        // let agmt_name = agmt_attrs['cn'][0];

                        // Compute state (enabled by default)
                        if ('nsds5replicaenabled' in agmt_attrs) {
                            if (agmt_attrs['nsds5replicaenabled'][0].toLowerCase() == 'off') {
                                state = "Disabled";
                            }
                        }

                        if ('nsds5replicalastupdatestatus' in agmt_attrs) {
                            update_status = agmt_attrs['nsds5replicalastupdatestatus'][0];
                        }

                        if ('nsds5replicalastinitstatus' in agmt_attrs &&
                            agmt_attrs['nsds5replicalastinitstatus'][0] != "") {
                            ws_agmt_init_status = agmt_attrs['nsds5replicalastinitstatus'][0];
                            if (ws_agmt_init_status == "Error (0) Total update in progress" ||
                                ws_agmt_init_status == "Error (0)") {
                                ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                            } else if (ws_agmt_init_status == "Error (0) Total update succeeded") {
                                ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initialized</i></td>;
                            } else {
                                ws_agmt_init_status = <td key={agmt_attrs['cn']}>{ws_agmt_init_status}</td>;
                            }
                        } else if ('nsds5replicalastinitstart' in agmt_attrs && agmt_attrs['nsds5replicalastinitstart'][0] == "19700101000000Z") {
                            ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Not initialized</i></td>;
                        } else if ('nsds5beginreplicarefresh' in agmt_attrs) {
                            ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                        }

                        // Update table
                        ws_rows.push({
                            'name': agmt_attrs['cn'],
                            'host': agmt_attrs['nsds5replicahost'],
                            'port': agmt_attrs['nsds5replicaport'],
                            'state': [state],
                            'status': [update_status],
                            'initstatus': [ws_agmt_init_status]
                        });
                    }
                    // Set winsync agmts
                    this.setState({
                        [suffix]: {
                            ...this.state[suffix],
                            winsyncRows: ws_rows,
                        },
                        suffixSpinning: false,
                        disabled: false,
                    });
                })
                .fail(() => {
                    this.setState({
                        suffixSpinning: false,
                        disabled: false,
                    });
                });
    }

    reloadConfig (suffix) {
        this.setState({
            suffixSpinning: true,
            disabled: true,
        });
        let cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "replication", "get", "--suffix", suffix
        ];
        log_cmd("reloadConfig", "Reload suffix repl config", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    const config = JSON.parse(content);
                    let current_role = "";
                    let nsds5replicaprecisetombstonepurging = false;
                    if ('nsds5replicaprecisetombstonepurging' in config['attrs']) {
                        if (config['attrs']['nsds5replicaprecisetombstonepurging'][0].toLowerCase() == "on") {
                            nsds5replicaprecisetombstonepurging = true;
                        }
                    }
                    // Set the replica role
                    if (config['attrs']['nsds5replicatype'][0] == "3") {
                        current_role = "Master";
                    } else {
                        if (config['attrs']['nsds5flags'][0] == "1") {
                            current_role = "Hub";
                        } else {
                            current_role = "Consumer";
                        }
                    }

                    this.setState({
                        [suffix]: {
                            role: current_role,
                            nsds5flags: config['attrs']['nsds5flags'][0],
                            nsds5replicatype: config['attrs']['nsds5replicatype'][0],
                            nsds5replicaid: 'nsds5replicaid' in config['attrs'] ? config['attrs']['nsds5replicaid'][0] : "",
                            nsds5replicabinddn: 'nsds5replicabinddn' in config['attrs'] ? config['attrs']['nsds5replicabinddn'] : "",
                            nsds5replicabinddngroup: 'nsds5replicabinddngroup' in config['attrs'] ? config['attrs']['nsds5replicabinddngroup'][0] : "",
                            nsds5replicabinddngroupcheckinterval: 'nsds5replicabinddngroupcheckinterval' in config['attrs'] ? config['attrs']['nsds5replicabinddngroupcheckinterval'][0] : "",
                            nsds5replicareleasetimeout: 'nsds5replicareleasetimeout' in config['attrs'] ? config['attrs']['nsds5replicareleasetimeout'][0] : "",
                            nsds5replicapurgedelay: 'nsds5replicapurgedelay' in config['attrs'] ? config['attrs']['nsds5replicapurgedelay'][0] : "",
                            nsds5replicatombstonepurgeinterval: 'nsds5replicatombstonepurgeinterval' in config['attrs'] ? config['attrs']['nsds5replicatombstonepurgeinterval'][0] : "",
                            nsds5replicaprecisetombstonepurging: nsds5replicaprecisetombstonepurging,
                            nsds5replicaprotocoltimeout: 'nsds5replicaprotocoltimeout' in config['attrs'] ? config['attrs']['nsds5replicaprotocoltimeout'][0] : "",
                            nsds5replicabackoffmin: 'nsds5replicabackoffmin' in config['attrs'] ? config['attrs']['nsds5replicabackoffmin'][0] : "",
                            nsds5replicabackoffmax: 'nsds5replicabackoffmax' in config['attrs'] ? config['attrs']['nsds5replicabackoffmax'][0] : "",
                        },
                        suffixSpinning: false,
                        disabled: false,
                        suffixKey: new Date(),
                    });
                })
                .fail(() => {
                    this.setState({
                        suffixSpinning: false,
                        disabled: false,
                    });
                });
    }

    reloadRUV (suffix) {
        this.setState({
            suffixSpinning: true,
            disabled: true,
        });
        // Load suffix RUV
        let cmd = ['dsconf', '-j', 'ldapi://%2fvar%2frun%2fslapd-' + this.props.serverId + '.socket',
            'replication', 'get-ruv', '--suffix=' + suffix];
        log_cmd('reloadRUV', 'Get the suffix RUV', cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    let ruvs = JSON.parse(content);
                    let ruv_rows = [];
                    for (let idx in ruvs['items']) {
                        let ruv = ruvs['items'][idx];
                        // Update table
                        ruv_rows.push({
                            'rid': ruv['rid'],
                            'url': ruv['url'],
                            'csn': ruv['csn'],
                            'raw_csn': ruv['raw_csn'],
                            'maxcsn': ruv['maxcsn'],
                            'raw_maxcsn': ruv['raw_maxcsn'],
                        });
                    }
                    this.setState({
                        [suffix]: {
                            ...this.state[suffix],
                            ruvRows: ruv_rows,
                        },
                        suffixSpinning: false,
                        disabled: false
                    });
                })
                .fail(err => {
                    let errMsg = JSON.parse(err);
                    if (errMsg.desc != "No such object") {
                        this.props.addNotification(
                            "error",
                            `Error loading suffix RUV - ${errMsg.desc}`
                        );
                    }
                    this.setState({
                        suffixSpinning: false,
                        disabled: false
                    });
                });
    }

    loadReplSuffix(suffix) {
        // Load everything, we must nest cockpit promise so we can proper set
        // the loading is finished.
        // - Get Suffix config
        // - Get Changelog Settings
        // - Get Repl agmts
        // - Get Winsync Agmts
        // - Get RUV's
        this.setState({
            activeKey: 1,
            suffixLoading: true,
            [suffix]: {},
        });

        let cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "replication", "get", "--suffix", suffix
        ];
        log_cmd("loadReplSuffix", "Load suffix repl config", cmd);
        cockpit
                .spawn(cmd, { superuser: true, err: "message" })
                .done(content => {
                    const config = JSON.parse(content);
                    let current_role = "";
                    let nsds5replicaprecisetombstonepurging = false;
                    if ('nsds5replicaprecisetombstonepurging' in config['attrs']) {
                        if (config['attrs']['nsds5replicaprecisetombstonepurging'][0].toLowerCase() == "on") {
                            nsds5replicaprecisetombstonepurging = true;
                        }
                    }
                    // Set the replica role
                    if (config['attrs']['nsds5replicatype'][0] == "3") {
                        current_role = "Master";
                    } else {
                        if (config['attrs']['nsds5flags'][0] == "1") {
                            current_role = "Hub";
                        } else {
                            current_role = "Consumer";
                        }
                    }

                    this.setState({
                        [suffix]: {
                            role: current_role,
                            nsds5flags: config['attrs']['nsds5flags'][0],
                            nsds5replicatype: config['attrs']['nsds5replicatype'][0],
                            nsds5replicaid: 'nsds5replicaid' in config['attrs'] ? config['attrs']['nsds5replicaid'][0] : "",
                            nsds5replicabinddn: 'nsds5replicabinddn' in config['attrs'] ? config['attrs']['nsds5replicabinddn'] : "",
                            nsds5replicabinddngroup: 'nsds5replicabinddngroup' in config['attrs'] ? config['attrs']['nsds5replicabinddngroup'][0] : "",
                            nsds5replicabinddngroupcheckinterval: 'nsds5replicabinddngroupcheckinterval' in config['attrs'] ? config['attrs']['nsds5replicabinddngroupcheckinterval'][0] : "",
                            nsds5replicareleasetimeout: 'nsds5replicareleasetimeout' in config['attrs'] ? config['attrs']['nsds5replicareleasetimeout'][0] : "",
                            nsds5replicapurgedelay: 'nsds5replicapurgedelay' in config['attrs'] ? config['attrs']['nsds5replicapurgedelay'][0] : "",
                            nsds5replicatombstonepurgeinterval: 'nsds5replicatombstonepurgeinterval' in config['attrs'] ? config['attrs']['nsds5replicatombstonepurgeinterval'][0] : "",
                            nsds5replicaprecisetombstonepurging: nsds5replicaprecisetombstonepurging,
                            nsds5replicaprotocoltimeout: 'nsds5replicaprotocoltimeout' in config['attrs'] ? config['attrs']['nsds5replicaprotocoltimeout'][0] : "",
                            nsds5replicabackoffmin: 'nsds5replicabackoffmin' in config['attrs'] ? config['attrs']['nsds5replicabackoffmin'][0] : "",
                            nsds5replicabackoffmax: 'nsds5replicabackoffmax' in config['attrs'] ? config['attrs']['nsds5replicabackoffmax'][0] : "",
                            clMaxEntries: "",
                            clMaxAge: "",
                            clTrimInt: "",
                            clEncrypt: false,
                        }
                    });

                    cmd = ['dsconf', '-j', 'ldapi://%2fvar%2frun%2fslapd-' + this.props.serverId + '.socket',
                        'replication', 'get-changelog', '--suffix', suffix];
                    log_cmd("loadReplSuffix", "Load the replication info", cmd);
                    cockpit
                            .spawn(cmd, { superuser: true, err: "message" })
                            .done(content => {
                                const config = JSON.parse(content);
                                let clMaxEntries = "";
                                let clMaxAge = "";
                                let clTrimInt = "";
                                let clEncrypt = false;
                                for (let attr in config['attrs']) {
                                    let val = config['attrs'][attr][0];
                                    if (attr == "nsslapd-changelogmaxentries") {
                                        clMaxEntries = val;
                                    }
                                    if (attr == "nsslapd-changelogmaxage") {
                                        clMaxAge = val;
                                    }
                                    if (attr == "nsslapd-changelogtrim-interval") {
                                        clTrimInt = val;
                                    }
                                    if (attr == "nsslapd-encryptionalgorithm") {
                                        clEncrypt = true;
                                    }
                                }
                                this.setState({
                                    [suffix]: {
                                        ...this.state[suffix],
                                        clMaxEntries: clMaxEntries,
                                        clMaxAge: clMaxAge,
                                        clTrimInt: clTrimInt,
                                        clEncrypt: clEncrypt,
                                    }
                                });

                                // Now load agmts, then the winsync agreement, and finally the RUV
                                cmd = [
                                    "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
                                    "repl-agmt", "list", "--suffix", suffix
                                ];
                                log_cmd("loadReplSuffix", "get repl agreements", cmd);
                                cockpit
                                        .spawn(cmd, { superuser: true, err: "message" })
                                        .done(content => {
                                            const obj = JSON.parse(content);
                                            let rows = [];
                                            for (let idx in obj['items']) {
                                                let agmt_attrs = obj['items'][idx]['attrs'];
                                                let state = "Enabled";
                                                let update_status = "";
                                                let agmt_init_status = "";

                                                // Compute state (enabled by default)
                                                if ('nsds5replicaenabled' in agmt_attrs) {
                                                    if (agmt_attrs['nsds5replicaenabled'][0].toLowerCase() == 'off') {
                                                        state = "Disabled";
                                                    }
                                                }

                                                // Check for status msgs
                                                if ('nsds5replicalastupdatestatus' in agmt_attrs) {
                                                    update_status = agmt_attrs['nsds5replicalastupdatestatus'][0];
                                                }
                                                if ('nsds5replicalastinitstatus' in agmt_attrs &&
                                                    agmt_attrs['nsds5replicalastinitstatus'][0] != "") {
                                                    agmt_init_status = agmt_attrs['nsds5replicalastinitstatus'][0];
                                                    if (agmt_init_status == "Error (0) Total update in progress" ||
                                                        agmt_init_status == "Error (0)") {
                                                        agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                                                    } else if (agmt_init_status == "Error (0) Total update succeeded") {
                                                        agmt_init_status = <td key={agmt_attrs['cn']}><i>Initialized</i></td>;
                                                    } else {
                                                        agmt_init_status = <td key={agmt_attrs['cn']}>{agmt_init_status}</td>;
                                                    }
                                                } else if ('nsds5replicalastinitstart' in agmt_attrs && agmt_attrs['nsds5replicalastinitstart'][0] == "19700101000000Z") {
                                                    agmt_init_status = <td key={agmt_attrs['cn']}><i>Not initialized</i></td>;
                                                } else if ('nsds5beginreplicarefresh' in agmt_attrs) {
                                                    agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                                                }

                                                // Update table
                                                rows.push({
                                                    'name': agmt_attrs['cn'],
                                                    'host': agmt_attrs['nsds5replicahost'],
                                                    'port': agmt_attrs['nsds5replicaport'],
                                                    'state': [state],
                                                    'status': [update_status],
                                                    'initstatus': [agmt_init_status]
                                                });
                                            }

                                            // Set agmt
                                            this.setState({
                                                [suffix]: {
                                                    ...this.state[suffix],
                                                    agmtRows: rows,
                                                }
                                            });

                                            // Load winsync agreements
                                            cmd = [
                                                "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
                                                "repl-winsync-agmt", "list", "--suffix", suffix
                                            ];
                                            log_cmd("loadReplSuffix", "Get Winsync Agreements", cmd);
                                            cockpit
                                                    .spawn(cmd, { superuser: true, err: "message" })
                                                    .done(content => {
                                                        const obj = JSON.parse(content);
                                                        let ws_rows = [];
                                                        for (var idx in obj['items']) {
                                                            let state = "Enabled";
                                                            let update_status = "";
                                                            let ws_agmt_init_status = "Initialized";
                                                            let agmt_attrs = obj['items'][idx]['attrs'];
                                                            // let agmt_name = agmt_attrs['cn'][0];

                                                            // Compute state (enabled by default)
                                                            if ('nsds5replicaenabled' in agmt_attrs) {
                                                                if (agmt_attrs['nsds5replicaenabled'][0].toLowerCase() == 'off') {
                                                                    state = "Disabled";
                                                                }
                                                            }

                                                            if ('nsds5replicalastupdatestatus' in agmt_attrs) {
                                                                update_status = agmt_attrs['nsds5replicalastupdatestatus'][0];
                                                            }

                                                            if ('nsds5replicalastinitstatus' in agmt_attrs &&
                                                                agmt_attrs['nsds5replicalastinitstatus'][0] != "") {
                                                                ws_agmt_init_status = agmt_attrs['nsds5replicalastinitstatus'][0];
                                                                if (ws_agmt_init_status == "Error (0) Total update in progress" ||
                                                                    ws_agmt_init_status == "Error (0)") {
                                                                    ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                                                                } else if (ws_agmt_init_status == "Error (0) Total update succeeded") {
                                                                    ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initialized</i></td>;
                                                                } else {
                                                                    ws_agmt_init_status = <td key={agmt_attrs['cn']}>{ws_agmt_init_status}</td>;
                                                                }
                                                            } else if ('nsds5replicalastinitstart' in agmt_attrs && agmt_attrs['nsds5replicalastinitstart'][0] == "19700101000000Z") {
                                                                ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Not initialized</i></td>;
                                                            } else if ('nsds5beginreplicarefresh' in agmt_attrs) {
                                                                ws_agmt_init_status = <td key={agmt_attrs['cn']}><i>Initializing</i><Spinner loading size="sm" /></td>;
                                                            }

                                                            // Update table
                                                            ws_rows.push({
                                                                'name': agmt_attrs['cn'],
                                                                'host': agmt_attrs['nsds5replicahost'],
                                                                'port': agmt_attrs['nsds5replicaport'],
                                                                'state': [state],
                                                                'status': [update_status],
                                                                'initstatus': [ws_agmt_init_status]
                                                            });
                                                        }
                                                        // Set winsync agmts
                                                        this.setState({
                                                            [suffix]: {
                                                                ...this.state[suffix],
                                                                winsyncRows: ws_rows,
                                                            }
                                                        });

                                                        // Load suffix RUV
                                                        cmd = ['dsconf', '-j', 'ldapi://%2fvar%2frun%2fslapd-' + this.props.serverId + '.socket',
                                                            'replication', 'get-ruv', '--suffix=' + suffix];
                                                        log_cmd('loadReplSuffix', 'Get the suffix RUV', cmd);
                                                        cockpit
                                                                .spawn(cmd, { superuser: true, err: "message" })
                                                                .done(content => {
                                                                    let ruvs = JSON.parse(content);
                                                                    let ruv_rows = [];
                                                                    for (let idx in ruvs['items']) {
                                                                        let ruv = ruvs['items'][idx];
                                                                        // Update table
                                                                        ruv_rows.push({
                                                                            'rid': ruv['rid'],
                                                                            'url': ruv['url'],
                                                                            'csn': ruv['csn'],
                                                                            'raw_csn': ruv['raw_csn'],
                                                                            'maxcsn': ruv['maxcsn'],
                                                                            'raw_maxcsn': ruv['raw_maxcsn'],
                                                                        });
                                                                    }

                                                                    this.setState({
                                                                        [suffix]: {
                                                                            ...this.state[suffix],
                                                                            ruvRows: ruv_rows,
                                                                        },
                                                                        suffixLoading: false,
                                                                        disableTree: false
                                                                    });
                                                                })
                                                                .fail(err => {
                                                                    let errMsg = JSON.parse(err);
                                                                    if (errMsg.desc != "No such object") {
                                                                        this.props.addNotification(
                                                                            "error",
                                                                            `Error loading suffix RUV - ${errMsg.desc}`
                                                                        );
                                                                    }
                                                                    this.setState({
                                                                        suffixLoading: false,
                                                                        disableTree: false
                                                                    });
                                                                });
                                                    })
                                                    .fail(err => {
                                                        let errMsg = JSON.parse(err);
                                                        this.props.addNotification(
                                                            "error",
                                                            `Error loading winsync agreements - ${errMsg.desc}`
                                                        );
                                                        this.setState({
                                                            suffixLoading: false,
                                                            disableTree: false
                                                        });
                                                    });
                                        })
                                        .fail(err => {
                                            let errMsg = JSON.parse(err);
                                            this.props.addNotification(
                                                "error",
                                                `Error loading replication agreements configuration - ${errMsg.desc}`
                                            );
                                            this.setState({
                                                suffixLoading: false,
                                                disableTree: false
                                            });
                                        });
                            })
                            .fail(err => {
                                // changelog failure
                                let errMsg = JSON.parse(err);
                                this.props.addNotification(
                                    "error",
                                    `Error loading replication changelog configuration - ${errMsg.desc}`
                                );
                                this.setState({
                                    suffixLoading: false,
                                    disableTree: false
                                });
                            });
                })
                .fail(() => {
                    this.setState({
                        suffixLoading: false,
                        disableTree: false,
                        node_replicated: false
                    });
                });
    }

    loadAttrs() {
        // Now get the schema that various tabs use
        const attr_cmd = [
            "dsconf", "-j", "ldapi://%2fvar%2frun%2fslapd-" + this.props.serverId + ".socket",
            "schema", "attributetypes", "list"
        ];
        log_cmd("Suffixes", "Get attrs", attr_cmd);
        cockpit
                .spawn(attr_cmd, { superuser: true, err: "message" })
                .done(content => {
                    let attrContent = JSON.parse(content);
                    let attrs = [];
                    for (let content of attrContent['items']) {
                        attrs.push(content.name[0]);
                    }
                    this.setState({
                        attributes: attrs,
                    });
                })
                .fail(err => {
                    let errMsg = JSON.parse(err);
                    this.props.addNotification(
                        "error",
                        `Failed to get attributes - ${errMsg.desc}`
                    );
                });
    }

    enableTree () {
        this.setState({
            disableTree: false
        });
    }

    disableTree () {
        this.setState({
            disableTree: true
        });
    }

    render() {
        const { nodes } = this.state;
        let repl_page = "";
        let disabled = "tree-view-container";
        if (this.state.disableTree) {
            disabled = "tree-view-container ds-disabled";
        }
        let repl_element =
            <h4>There are currently no databases to configure for replication</h4>;
        if (this.state.loaded) {
            // We have a suffix, or database link
            if (this.state.node_type == "suffix" || this.state.node_type == "subsuffix") {
                if (this.state.suffixLoading) {
                    repl_element =
                        <div className="ds-margin-top ds-loading-spinner ds-center">
                            <h4>Loading replication configuration for <b>{this.state.node_name} ...</b></h4>
                            <Spinner className="ds-margin-top-lg" loading size="md" />
                        </div>;
                } else {
                    if (this.state.node_name in this.state) {
                        repl_element =
                            <div>
                                <ReplSuffix
                                    serverId={this.props.serverId}
                                    suffix={this.state.node_name}
                                    role={this.state[this.state.node_name].role}
                                    data={this.state[this.state.node_name]}
                                    addNotification={this.props.addNotification}
                                    agmtRows={this.state[this.state.node_name].agmtRows}
                                    winsyncRows={this.state[this.state.node_name].winsyncRows}
                                    ruvRows={this.state[this.state.node_name].ruvRows}
                                    reloadAgmts={this.reloadAgmts}
                                    reloadWinsyncAgmts={this.reloadWinsyncAgmts}
                                    reloadRUV={this.reloadRUV}
                                    reloadConfig={this.reloadConfig}
                                    reload={this.loadSuffixTree}
                                    attrs={this.state.attributes}
                                    replicated={this.state.node_replicated}
                                    enableTree={this.enableTree}
                                    disableTree={this.disableTree}
                                    key={this.state.suffixKey}
                                    disabled={this.state.disabled}
                                    spinning={this.state.suffixSpinning}
                                />
                            </div>;
                    } else {
                        // Suffix is not replicated
                        repl_element =
                            <ReplSuffix
                                serverId={this.props.serverId}
                                suffix={this.state.node_name}
                                role=""
                                data=""
                                addNotification={this.props.addNotification}
                                disableWSAgmtTable={this.state.disableWSAgmtTable}
                                disableAgmtTable={this.state.disableAgmtTable}
                                reloadAgmts={this.reloadAgmts}
                                reloadWinsyncAgmts={this.reloadWinsyncAgmts}
                                reloadRUV={this.reloadRUV}
                                reloadConfig={this.reloadConfig}
                                reload={this.loadSuffixTree}
                                attrs={this.state.attributes}
                                replicated={this.state.node_replicated}
                                enableTree={this.enableTree}
                                disableTree={this.disableTree}
                                spinning={this.state.suffixSpinning}
                                disabled={this.state.disabled}
                                key={this.state.node_name}
                            />;
                    }
                }
            }
            repl_page =
                <div className="container-fluid">
                    <div className="ds-container">
                        <div>
                            <div className="ds-tree">
                                <div className={disabled} id="repl-tree"
                                    style={treeViewContainerStyles}>
                                    <TreeView
                                        nodes={nodes}
                                        highlightOnHover
                                        highlightOnSelect
                                        selectNode={this.selectNode}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="ds-tree-content">
                            {repl_element}
                        </div>
                    </div>
                </div>;
        } else {
            repl_page =
                <div className="ds-margin-top ds-loading-spinner ds-center">
                    <h4>Loading Replication Information ...</h4>
                    <Spinner className="ds-margin-top-lg" loading size="md" />
                </div>;
        }

        return (
            <div>
                {repl_page}
            </div>
        );
    }
}

// Property types and defaults

Replication.propTypes = {
    addNotification: PropTypes.func,
    serverId: PropTypes.string
};

Replication.defaultProps = {
    addNotification: noop,
    serverId: ""
};

export default Replication;
