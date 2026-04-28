package com.amazon.paidatacollector.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.amazon.paidatacollector.PAIApp
import com.amazon.paidatacollector.databinding.ActivityWorkspaceListBinding
import com.amazon.paidatacollector.databinding.ItemWorkspaceBinding
import com.amazon.paidatacollector.workspace.WorkspaceConfig
import com.amazonaws.mobile.client.AWSMobileClient
import com.amazonaws.mobile.client.Callback
import com.amazonaws.mobile.client.UserStateDetails

class WorkspaceListActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWorkspaceListBinding
    private lateinit var adapter: WorkspaceAdapter

    companion object {
        private const val TAG = "WorkspaceListActivity"
        const val REQUEST_CODE_QR = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityWorkspaceListBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }

        setupRecyclerView()

        binding.fabAddQR.setOnClickListener {
            val intent = Intent(this, QRScanActivity::class.java)
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_CODE_QR)
        }
    }

    private fun setupRecyclerView() {
        val manager = (application as PAIApp).workspaceManager
        val workspaces = manager.getAll()
        val activeId = manager.getActive()?.id

        adapter = WorkspaceAdapter(
            workspaces = workspaces.toMutableList(),
            activeId = activeId,
            onItemClick = { config -> switchWorkspace(config) },
            onItemLongClick = { config -> confirmDeleteWorkspace(config) }
        )

        binding.rvWorkspaces.layoutManager = LinearLayoutManager(this)
        binding.rvWorkspaces.adapter = adapter
    }

    private fun refreshList() {
        val manager = (application as PAIApp).workspaceManager
        val workspaces = manager.getAll()
        val activeId = manager.getActive()?.id
        adapter.updateData(workspaces, activeId)
    }

    private fun switchWorkspace(config: WorkspaceConfig) {
        val manager = (application as PAIApp).workspaceManager
        if (manager.getActive()?.id == config.id) {
            toast("This workspace is already active")
            return
        }

        Log.i(TAG, "Switching to workspace: ${config.id} (${config.workspaceName})")

        try {
            AWSMobileClient.getInstance().signOut()
        } catch (e: Exception) {
            Log.w(TAG, "SignOut warning (ignoring): ${e.message}")
        }

        manager.setActive(config.id)

        PAIApp.initAwsWithConfig(
            applicationContext,
            config,
            object : Callback<UserStateDetails> {
                override fun onResult(result: UserStateDetails?) {
                    Log.d(TAG, "AWS re-initialized for workspace ${config.id}, state: ${result?.userState}")
                    runOnUiThread {
                        toast("Switching to '${config.workspaceName}'")
                        val intent = Intent(this@WorkspaceListActivity, LoginActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                    }
                }

                override fun onError(e: Exception?) {
                    Log.e(TAG, "AWS re-init error for workspace ${config.id}", e)
                    runOnUiThread {
                        toast("Workspace switch failed: ${e?.message}")
                        manager.setActive(manager.getAll().firstOrNull()?.id ?: "default")
                    }
                }
            }
        )
    }

    private fun confirmDeleteWorkspace(config: WorkspaceConfig) {
        val manager = (application as PAIApp).workspaceManager
        if (config.isGlobal) {
            toast("The default workspace cannot be deleted")
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Delete Workspace")
            .setMessage("Delete '${config.workspaceName}'?")
            .setPositiveButton("Delete") { _, _ ->
                val removed = manager.remove(config.id)
                if (removed) {
                    toast("'${config.workspaceName}' deleted")
                    refreshList()
                } else {
                    toast("This workspace cannot be deleted")
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_QR && resultCode == Activity.RESULT_OK) {
            Log.d(TAG, "QR scan completed successfully, refreshing list")
            refreshList()
            toast("New workspace added")
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}

// ── WorkspaceAdapter ───────────────────────────────────────────────────────────

class WorkspaceAdapter(
    private val workspaces: MutableList<WorkspaceConfig>,
    private var activeId: String?,
    private val onItemClick: (WorkspaceConfig) -> Unit,
    private val onItemLongClick: (WorkspaceConfig) -> Unit,
) : RecyclerView.Adapter<WorkspaceAdapter.WorkspaceViewHolder>() {

    inner class WorkspaceViewHolder(val binding: ItemWorkspaceBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WorkspaceViewHolder {
        val binding = ItemWorkspaceBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return WorkspaceViewHolder(binding)
    }

    override fun onBindViewHolder(holder: WorkspaceViewHolder, position: Int) {
        val config = workspaces[position]
        with(holder.binding) {
            tvWorkspaceName.text = config.workspaceName
            tvOrgName.text = "${config.orgName}  ·  ${config.region}"
            ivActive.visibility = if (config.id == activeId) View.VISIBLE else View.GONE
        }
        holder.itemView.setOnClickListener { onItemClick(config) }
        holder.itemView.setOnLongClickListener {
            onItemLongClick(config)
            true
        }
    }

    override fun getItemCount(): Int = workspaces.size

    fun updateData(newWorkspaces: List<WorkspaceConfig>, newActiveId: String?) {
        workspaces.clear()
        workspaces.addAll(newWorkspaces)
        activeId = newActiveId
        notifyDataSetChanged()
    }
}
