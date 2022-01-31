using AutoMapper;
using Docstore.App.Common.Extendeds;
using Docstore.App.Common.Extensions;
using Docstore.App.Models;
using Docstore.App.Models.Abstracts;
using Docstore.App.Models.Forms;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Controllers
{
    [Authorize]
    public class FoldersController : ExtendedController
    {
        private const int PAGE_SIZE = 6;

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
        public async Task<IActionResult> Index(int? page = 1)
        {
            // get data
            var folders = await _folderRepository.GetPagedReponseAsync(UserId, page ?? 1, PAGE_SIZE);

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
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Create(FolderForm? form)
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
                    return RedirectToAction(nameof(Show), new { Id = folder.Id })
                        .AddToast(TempData, ToastType.Success, $"\"{folder.Name}\" successfuly created!");
                }
            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // response
            var viewModel = new FolderCreateViewModel
            {
                Form = form ?? FolderFormViewModel.GetDefaultFormValues()
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

        public async Task<IActionResult> Edit(int id)
        {
            // check if exist
            var folder = await _folderRepository.FindByIdAsync(UserId, id);
            if (folder == null)
                return RedirectToAction(nameof(Index))
                    .AddToast(TempData, ToastType.Error, "This folder does not exist.");

            return EditDefault(folder);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Edit(int id, FolderForm? form)
        {
            var folder = await _folderRepository.FindByIdAsync(UserId, id);

            if (folder == null)
                return NotFound();

            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    // copie new data in entity
                    _mapper.Map(form, folder);

                    // save in database
                    await _folderRepository.UpdateAsync(folder, save: true);

                    // response
                    return RedirectToAction(nameof(Index))
                        .AddToast(TempData, ToastType.Success, $"\"{folder.Name}\" successfuly updated!");
                }
            }
            catch (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            return EditDefault(folder);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Delete(int id)
        {
            var folder = await _folderRepository.FindByIdAsync(UserId, id);

            if (folder == null)
                return NotFound();

            // delete
            await _folderRepository.DeleteAsync(folder, save: true);

            return RedirectToAction(nameof(Index))
                .AddToast(TempData, ToastType.Success, $"\"{folder.Name}\" has been deleted!");
        }
        #endregion

        #region privates
        private IActionResult EditDefault(Folder folder)
        {
            // data
            var form = _mapper.Map<FolderForm>(folder);

            // response
            var viewModel = new FolderEditViewModel()
            {
                Form = form
            };
            return View(viewModel);
        }
        #endregion
    }
}
