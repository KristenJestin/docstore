using AutoMapper;
using Docstore.App.Common;
using Docstore.App.Common.Extendeds;
using Docstore.App.Models;
using Docstore.App.Models.Forms;
using Docstore.Application.Interfaces;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Docstore.App.Controllers
{
    [Authorize]
    public class FoldersController : ExtendedController
    {
        private readonly IMapper _mapper;
        private readonly ApplicationDbContext _db;
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly IFolderRepository _folderRepository;

        public FoldersController(ApplicationDbContext db, IMapper mapper, IWebHostEnvironment hostingEnvironment, IFolderRepository folderRepository)
        {
            _db = db;
            _mapper = mapper;
            _hostingEnvironment = hostingEnvironment;
            _folderRepository = folderRepository;
        }


        #region actions
        public async Task<IActionResult> Index()
        {
            // get data
            var folders = await _db.Folders
                .Where(x => x.UserId == UserId)
                .OrderByDescending(d => d.CreatedAt)
                .ToListAsync();

            // response
            var viewModel = new FoldersIndexViewModel
            {
                Folders = folders
            };
            return View(viewModel);
        }

        public IActionResult Create()
        {
            // response
            var viewModel = new FolderCreateViewModel();
            return View(viewModel);
        }

        [HttpPost]
        public async Task<IActionResult> Create(FolderCreateForm? form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    // transform to database entity
                    var folder = _mapper.Map<Folder>(form);
                    folder.UserId = UserId;

                    // save in database
                    await _db.AddAsync(folder);
                    await _db.SaveChangesAsync();

                    // response
                    return RedirectToAction(nameof(Show), new { folder.Id });
                }
            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // response
            var viewModel = new FolderCreateViewModel
            {
                Form = form ?? FolderCreateViewModel.GetDefaultFormValues()
            };
            return View(viewModel);
        }

        public async Task<IActionResult> Show(int id)
        {
            var folder = await _folderRepository.FindByIdAsync(UserId, id);

            if (folder == null)
                return NotFound();

            // response
            var viewModel = new FolderShowViewModel(folder);
            return View(viewModel);
        }
        #endregion
    }
}
